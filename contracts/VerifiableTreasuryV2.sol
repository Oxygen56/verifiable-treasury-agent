// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.28;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";

/// @title VerifiableTreasuryV2
/// @notice Policy-bound treasury settlement where AI may relay an intent but cannot authorize it.
/// @dev Raw invoice, identity and screening records stay off-chain. Commitments and policy digests are public.
contract VerifiableTreasuryV2 is AccessControl, Pausable, ReentrancyGuard, EIP712 {
    using SafeERC20 for IERC20;

    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");
    bytes32 public constant APPROVER_ROLE = keccak256("APPROVER_ROLE");
    bytes32 public constant COMPLIANCE_ROLE = keccak256("COMPLIANCE_ROLE");
    bytes32 public constant INVOICE_COMMITMENT_DOMAIN = keccak256("VTA_INVOICE_COMMITMENT_V2");
    uint256 public constant RISK_ATTESTATION_MAX_AGE = 7 days;
    bytes32 public constant SETTLEMENT_INTENT_TYPEHASH = keccak256(
        "SettlementIntent(address payer,address beneficiary,uint128 amount,uint48 expiresAt,uint48 quoteValidUntil,bytes32 clearanceId,bytes32 invoiceCommitment,bytes32 policyDigest,bytes32 corridorDigest,bytes32 quoteDigest,uint256 clientOrderId,uint256 nonce)"
    );

    enum State { None, Proposed, Approved, Funded, Released, Cancelled }

    struct SettlementIntent {
        address payer;
        address beneficiary;
        uint128 amount;
        uint48 expiresAt;
        uint48 quoteValidUntil;
        bytes32 clearanceId;
        bytes32 invoiceCommitment;
        bytes32 policyDigest;
        bytes32 corridorDigest;
        bytes32 quoteDigest;
        uint256 clientOrderId;
        uint256 nonce;
    }

    struct Settlement {
        address payer;
        address beneficiary;
        uint128 amount;
        uint48 createdAt;
        uint48 fundedAt;
        uint48 releaseAfter;
        uint48 expiresAt;
        uint48 quoteValidUntil;
        bytes32 clearanceId;
        bytes32 invoiceCommitment;
        bytes32 policyDigest;
        bytes32 corridorDigest;
        bytes32 quoteDigest;
        uint256 clientOrderId;
        State state;
        uint8 approvals;
        uint64 approvalRound;
        uint64 payerRiskEpoch;
        address approver1;
        address approver2;
        uint64 approver1Epoch;
        uint64 approver2Epoch;
    }

    struct Clearance {
        address payer;
        address beneficiary;
        bytes32 policyDigest;
        bytes32 corridorDigest;
        uint128 maxAmount;
        uint128 consumedAmount;
        uint48 validUntil;
        address issuer;
        uint64 issuerEpoch;
        uint64 payerRiskEpoch;
        uint64 subjectRiskEpoch;
    }

    struct SubjectRisk {
        bool initialized;
        bool sanctioned;
        uint64 epoch;
        bytes32 evidenceDigest;
        address attestor;
        uint64 attestorEpoch;
        uint48 screenedAt;
    }

    struct RiskClearProposal {
        address firstCompliance;
        bytes32 evidenceDigest;
        uint64 firstComplianceEpoch;
        uint64 riskEpoch;
    }

    IERC20 public immutable stablecoin;
    uint256 public immutable dailyLimit;
    uint256 public immutable highValueThreshold;
    uint256 public immutable minimumChallengeWindow;
    uint256 public nextSettlementId = 1;
    uint256 public totalEscrowed;

    mapping(uint256 => Settlement) public settlements;
    mapping(uint256 => mapping(address => uint64)) public approvedInRound;
    mapping(bytes32 => Clearance) public clearances;
    mapping(address => SubjectRisk) public subjectRisks;
    mapping(address => RiskClearProposal) public riskClearProposals;
    mapping(address => uint256) public issuerClearanceNonces;
    mapping(bytes32 => mapping(address => uint64)) public roleMembershipEpoch;
    mapping(bytes32 => bool) public revokedClearances;
    mapping(address => mapping(uint256 => uint256)) public spentPerDay;
    mapping(address => uint256) public payerNonces;
    mapping(address => mapping(uint256 => bool)) public usedClientOrderIds;
    mapping(address => mapping(bytes32 => bool)) public usedInvoiceCommitments;

    event SubjectRiskRecorded(address indexed beneficiary, bool sanctioned, uint64 epoch, bytes32 evidenceDigest, uint48 screenedAt);
    event SubjectRiskClearanceProposed(address indexed beneficiary, address indexed firstCompliance, bytes32 evidenceDigest, uint64 firstComplianceEpoch);
    event ClearanceIssued(bytes32 indexed clearanceId, address indexed payer, address indexed beneficiary, address issuer, bytes32 policyDigest, bytes32 corridorDigest, uint128 maxAmount, uint48 validUntil, uint64 subjectRiskEpoch);
    event ClearanceConsumptionChanged(bytes32 indexed clearanceId, uint128 consumedAmount, uint128 maxAmount);
    event ClearanceRevoked(bytes32 indexed clearanceId, address indexed actor);
    event SettlementApprovalsReset(uint256 indexed id, uint64 approvalRound);
    event SettlementProposed(uint256 indexed id, address indexed payer, address indexed beneficiary, uint256 amount, uint256 clientOrderId, bytes32 clearanceId, bytes32 intentHash, bytes32 invoiceCommitment, bytes32 corridorDigest, bytes32 quoteDigest, uint48 expiresAt, uint48 quoteValidUntil);
    event SettlementApproved(uint256 indexed id, address indexed approver, uint8 approvals, uint8 requiredApprovals, uint64 approvalRound, uint64 membershipEpoch);
    event SettlementFunded(uint256 indexed id, uint256 amount, uint48 fundedAt, uint48 releaseAfter);
    event SettlementReleased(uint256 indexed id, address indexed beneficiary, uint256 amount);
    event SettlementCancelled(uint256 indexed id, address indexed actor, bytes32 indexed reasonDigest, uint256 refundedAmount);
    event PayerNonceInvalidated(address indexed payer, uint256 previousNonce, uint256 newNonce);

    error InvalidState(State expected, State actual);
    error InvalidSchedule();
    error InvalidAmount();
    error InvalidCommitment();
    error InvalidSignature();
    error InvalidNonce();
    error DuplicateClientOrder();
    error DuplicateInvoiceCommitment();
    error ClearanceInvalid();
    error BeneficiarySanctioned();
    error PayerSanctioned();
    error AlreadyApproved();
    error ConflictOfInterest();
    error NotPayer();
    error NotCancellable();
    error ReleaseNotReady();
    error SettlementExpired();
    error DailyLimitExceeded();
    error UnauthorizedCancellation();
    error DeflationaryAssetUnsupported();
    error RoleOverlap();
    error ClearanceVersionChanged();
    error ApprovalNoLongerValid();
    error QuoteExpired();
    error RiskAlreadyInitialized();
    error RiskNotInitialized();
    error RiskClearanceRequiresTwoPeople();
    error DuplicateClearance();

    constructor(
        IERC20 stablecoin_,
        address admin,
        uint256 dailyLimit_,
        uint256 highValueThreshold_,
        uint256 minimumChallengeWindow_
    ) EIP712("VerifiableTreasury", "2") {
        if (address(stablecoin_) == address(0) || admin == address(0)) revert InvalidAmount();
        if (dailyLimit_ == 0 || highValueThreshold_ == 0 || minimumChallengeWindow_ == 0) revert InvalidAmount();
        stablecoin = stablecoin_;
        dailyLimit = dailyLimit_;
        highValueThreshold = highValueThreshold_;
        minimumChallengeWindow = minimumChallengeWindow_;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    /// @dev Governance, operator, approval, and compliance identities are mutually exclusive.
    function grantRole(bytes32 role, address account) public override onlyRole(getRoleAdmin(role)) {
        if (_isSeparatedRole(role)) {
            if (role != DEFAULT_ADMIN_ROLE && hasRole(DEFAULT_ADMIN_ROLE, account)) revert RoleOverlap();
            if (role != OPERATOR_ROLE && hasRole(OPERATOR_ROLE, account)) revert RoleOverlap();
            if (role != APPROVER_ROLE && hasRole(APPROVER_ROLE, account)) revert RoleOverlap();
            if (role != COMPLIANCE_ROLE && hasRole(COMPLIANCE_ROLE, account)) revert RoleOverlap();
        }
        _grantRole(role, account);
    }

    /// @notice Initializes a screened subject. A later sanctions flag takes effect across every open credential.
    function attestInitialRisk(address beneficiary, bool sanctioned, bytes32 evidenceDigest)
        external onlyRole(COMPLIANCE_ROLE)
    {
        if (beneficiary == address(0) || evidenceDigest == bytes32(0)) revert ClearanceInvalid();
        if (!_isCleanParticipant(beneficiary) || beneficiary == msg.sender) revert ConflictOfInterest();
        if (subjectRisks[beneficiary].initialized) revert RiskAlreadyInitialized();
        subjectRisks[beneficiary] = SubjectRisk(
            true,
            sanctioned,
            1,
            evidenceDigest,
            msg.sender,
            roleMembershipEpoch[COMPLIANCE_ROLE][msg.sender],
            uint48(block.timestamp)
        );
        emit SubjectRiskRecorded(beneficiary, sanctioned, 1, evidenceDigest, uint48(block.timestamp));
    }

    /// @notice Any authorized compliance-role address can fail closed immediately.
    function flagSubjectSanctioned(address beneficiary, bytes32 evidenceDigest)
        external onlyRole(COMPLIANCE_ROLE)
    {
        SubjectRisk storage risk = subjectRisks[beneficiary];
        if (!risk.initialized) revert RiskNotInitialized();
        if (beneficiary == msg.sender || evidenceDigest == bytes32(0)) revert ConflictOfInterest();
        if (risk.sanctioned) revert BeneficiarySanctioned();
        risk.sanctioned = true;
        risk.epoch += 1;
        risk.evidenceDigest = evidenceDigest;
        risk.attestor = msg.sender;
        risk.attestorEpoch = roleMembershipEpoch[COMPLIANCE_ROLE][msg.sender];
        risk.screenedAt = uint48(block.timestamp);
        delete riskClearProposals[beneficiary];
        emit SubjectRiskRecorded(beneficiary, true, risk.epoch, evidenceDigest, risk.screenedAt);
    }

    /// @notice Clearing a sanctions flag requires two distinct, currently authorized compliance-role addresses.
    function proposeSubjectRiskClear(address beneficiary, bytes32 evidenceDigest)
        external onlyRole(COMPLIANCE_ROLE)
    {
        SubjectRisk memory risk = subjectRisks[beneficiary];
        if (!risk.initialized) revert RiskNotInitialized();
        if (!risk.sanctioned || evidenceDigest == bytes32(0) || beneficiary == msg.sender) revert ClearanceInvalid();
        riskClearProposals[beneficiary] = RiskClearProposal(
            msg.sender,
            evidenceDigest,
            roleMembershipEpoch[COMPLIANCE_ROLE][msg.sender],
            risk.epoch
        );
        emit SubjectRiskClearanceProposed(
            beneficiary,
            msg.sender,
            evidenceDigest,
            roleMembershipEpoch[COMPLIANCE_ROLE][msg.sender]
        );
    }

    function confirmSubjectRiskClear(address beneficiary, bytes32 evidenceDigest)
        external onlyRole(COMPLIANCE_ROLE)
    {
        SubjectRisk storage risk = subjectRisks[beneficiary];
        RiskClearProposal memory proposal = riskClearProposals[beneficiary];
        if (!risk.initialized) revert RiskNotInitialized();
        if (
            !risk.sanctioned || beneficiary == msg.sender || proposal.firstCompliance == address(0)
                || proposal.firstCompliance == msg.sender || proposal.evidenceDigest != evidenceDigest
                || proposal.riskEpoch != risk.epoch
                || !hasRole(COMPLIANCE_ROLE, proposal.firstCompliance)
                || roleMembershipEpoch[COMPLIANCE_ROLE][proposal.firstCompliance] != proposal.firstComplianceEpoch
        ) revert RiskClearanceRequiresTwoPeople();
        risk.sanctioned = false;
        risk.epoch += 1;
        risk.evidenceDigest = evidenceDigest;
        risk.attestor = msg.sender;
        risk.attestorEpoch = roleMembershipEpoch[COMPLIANCE_ROLE][msg.sender];
        risk.screenedAt = uint48(block.timestamp);
        delete riskClearProposals[beneficiary];
        emit SubjectRiskRecorded(beneficiary, false, risk.epoch, evidenceDigest, risk.screenedAt);
    }

    /// @notice Rotates the accountable attestor without changing a subject's risk verdict or epoch.
    function reattestSubjectRisk(address beneficiary, bytes32 evidenceDigest)
        external onlyRole(COMPLIANCE_ROLE)
    {
        SubjectRisk storage risk = subjectRisks[beneficiary];
        if (!risk.initialized) revert RiskNotInitialized();
        if (beneficiary == msg.sender || evidenceDigest == bytes32(0)) revert ConflictOfInterest();
        risk.evidenceDigest = evidenceDigest;
        risk.attestor = msg.sender;
        risk.attestorEpoch = roleMembershipEpoch[COMPLIANCE_ROLE][msg.sender];
        risk.screenedAt = uint48(block.timestamp);
        delete riskClearProposals[beneficiary];
        emit SubjectRiskRecorded(beneficiary, risk.sanctioned, risk.epoch, evidenceDigest, risk.screenedAt);
    }

    /// @notice Issues an append-only, route- and amount-bound credential so concurrent settlements do not collide.
    function issueClearance(
        address payer,
        address beneficiary,
        bytes32 policyDigest,
        bytes32 corridorDigest,
        uint128 maxAmount,
        uint48 validUntil
    ) external onlyRole(COMPLIANCE_ROLE) returns (bytes32 clearanceId) {
        SubjectRisk memory risk = subjectRisks[beneficiary];
        if (!risk.initialized) revert RiskNotInitialized();
        if (risk.sanctioned) revert BeneficiarySanctioned();
        if (
            payer == address(0) || payer == beneficiary || !_isCleanParticipant(payer)
                || !_isCleanParticipant(beneficiary) || beneficiary == msg.sender || payer == msg.sender
        ) revert ConflictOfInterest();
        SubjectRisk memory payerRisk = subjectRisks[payer];
        if (!payerRisk.initialized) revert RiskNotInitialized();
        if (payerRisk.sanctioned) revert PayerSanctioned();
        if (!_isUsableRiskAttestation(payerRisk) || !_isUsableRiskAttestation(risk)) revert ClearanceVersionChanged();
        if (
            policyDigest == bytes32(0) || corridorDigest == bytes32(0) || maxAmount == 0
                || validUntil <= block.timestamp
        ) revert ClearanceInvalid();

        uint256 issuerNonce = issuerClearanceNonces[msg.sender]++;
        clearanceId = keccak256(abi.encode(
            block.chainid,
            address(this),
            msg.sender,
            issuerNonce,
            payer,
            beneficiary,
            policyDigest,
            corridorDigest,
            maxAmount,
            validUntil,
            risk.epoch
        ));
        if (clearances[clearanceId].issuer != address(0)) revert DuplicateClearance();
        clearances[clearanceId] = Clearance({
            payer: payer,
            beneficiary: beneficiary,
            policyDigest: policyDigest,
            corridorDigest: corridorDigest,
            maxAmount: maxAmount,
            consumedAmount: 0,
            validUntil: validUntil,
            issuer: msg.sender,
            issuerEpoch: roleMembershipEpoch[COMPLIANCE_ROLE][msg.sender],
            payerRiskEpoch: payerRisk.epoch,
            subjectRiskEpoch: risk.epoch
        });
        emit ClearanceIssued(clearanceId, payer, beneficiary, msg.sender, policyDigest, corridorDigest, maxAmount, validUntil, risk.epoch);
    }

    /// @notice Anyone, including an AI relayer, may relay a payer-signed intent. Only the signature authorizes it.
    function proposeWithSignature(SettlementIntent calldata intent, bytes calldata signature)
        external whenNotPaused returns (uint256 id)
    {
        if (intent.payer == address(0) || intent.beneficiary == address(0) || intent.amount == 0) revert InvalidAmount();
        if (intent.payer == intent.beneficiary) revert ConflictOfInterest();
        if (!_isCleanParticipant(intent.payer) || !_isCleanParticipant(intent.beneficiary)) revert ConflictOfInterest();
        SubjectRisk memory payerRisk = subjectRisks[intent.payer];
        if (!payerRisk.initialized) revert RiskNotInitialized();
        if (payerRisk.sanctioned) revert PayerSanctioned();
        if (!_isUsableRiskAttestation(payerRisk)) revert ClearanceVersionChanged();
        if (intent.clientOrderId == 0) revert InvalidCommitment();
        if (
            intent.clearanceId == bytes32(0) || intent.invoiceCommitment == bytes32(0) || intent.policyDigest == bytes32(0)
                || intent.corridorDigest == bytes32(0) || intent.quoteDigest == bytes32(0)
        ) revert InvalidCommitment();
        if (
            intent.expiresAt <= block.timestamp + minimumChallengeWindow
                || intent.quoteValidUntil <= block.timestamp || intent.quoteValidUntil > intent.expiresAt
        ) revert InvalidSchedule();
        if (intent.nonce != payerNonces[intent.payer]) revert InvalidNonce();
        if (usedClientOrderIds[intent.payer][intent.clientOrderId]) revert DuplicateClientOrder();
        if (usedInvoiceCommitments[intent.payer][intent.invoiceCommitment]) revert DuplicateInvoiceCommitment();

        bytes32 digest = _hashIntent(intent);
        if (!SignatureChecker.isValidSignatureNow(intent.payer, digest, signature)) revert InvalidSignature();

        _requireIntentClearance(intent);

        payerNonces[intent.payer] = intent.nonce + 1;
        usedClientOrderIds[intent.payer][intent.clientOrderId] = true;
        usedInvoiceCommitments[intent.payer][intent.invoiceCommitment] = true;

        id = nextSettlementId++;
        settlements[id] = Settlement({
            payer: intent.payer,
            beneficiary: intent.beneficiary,
            amount: intent.amount,
            createdAt: uint48(block.timestamp),
            fundedAt: 0,
            releaseAfter: 0,
            expiresAt: intent.expiresAt,
            quoteValidUntil: intent.quoteValidUntil,
            clearanceId: intent.clearanceId,
            invoiceCommitment: intent.invoiceCommitment,
            policyDigest: intent.policyDigest,
            corridorDigest: intent.corridorDigest,
            quoteDigest: intent.quoteDigest,
            clientOrderId: intent.clientOrderId,
            state: State.Proposed,
            approvals: 0,
            approvalRound: 1,
            payerRiskEpoch: payerRisk.epoch,
            approver1: address(0),
            approver2: address(0),
            approver1Epoch: 0,
            approver2Epoch: 0
        });
        emit SettlementProposed(
            id,
            intent.payer,
            intent.beneficiary,
            intent.amount,
            intent.clientOrderId,
            intent.clearanceId,
            digest,
            intent.invoiceCommitment,
            intent.corridorDigest,
            intent.quoteDigest,
            intent.expiresAt,
            intent.quoteValidUntil
        );
    }

    function hashIntent(SettlementIntent calldata intent) external view returns (bytes32) {
        return _hashIntent(intent);
    }

    function revokeClearance(bytes32 clearanceId) external {
        Clearance memory clearance = clearances[clearanceId];
        if (clearance.issuer == address(0)) revert ClearanceInvalid();
        if (msg.sender != clearance.issuer && !hasRole(DEFAULT_ADMIN_ROLE, msg.sender)) revert UnauthorizedCancellation();
        revokedClearances[clearanceId] = true;
        emit ClearanceRevoked(clearanceId, msg.sender);
    }

    /// @notice Cancels any leaked or abandoned signed intents below a new monotonic nonce.
    function invalidateNoncesUpTo(uint256 newNonce) external {
        uint256 previousNonce = payerNonces[msg.sender];
        if (newNonce <= previousNonce) revert InvalidNonce();
        payerNonces[msg.sender] = newNonce;
        emit PayerNonceInvalidated(msg.sender, previousNonce, newNonce);
    }

    /// @notice Domain-separates a private invoice from other chains, contracts, parties, routes, and orders.
    function computeInvoiceCommitment(
        address payer,
        address beneficiary,
        uint128 amount,
        bytes32 corridorDigest,
        uint256 clientOrderId,
        bytes calldata invoiceData,
        bytes32 salt
    ) public view returns (bytes32) {
        return keccak256(abi.encode(
            INVOICE_COMMITMENT_DOMAIN,
            block.chainid,
            address(this),
            payer,
            beneficiary,
            amount,
            corridorDigest,
            clientOrderId,
            invoiceData,
            salt
        ));
    }

    function requiredApprovals(uint256 id) public view returns (uint8) {
        return settlements[id].amount >= highValueThreshold ? 2 : 1;
    }

    function approveSettlement(uint256 id) external onlyRole(APPROVER_ROLE) whenNotPaused {
        Settlement storage settlement = settlements[id];
        if (settlement.state != State.Proposed) revert InvalidState(State.Proposed, settlement.state);
        if (msg.sender == settlement.payer || msg.sender == settlement.beneficiary) revert ConflictOfInterest();
        if (hasRole(OPERATOR_ROLE, msg.sender) || hasRole(COMPLIANCE_ROLE, msg.sender)) revert ConflictOfInterest();
        if (approvedInRound[id][msg.sender] == settlement.approvalRound) revert AlreadyApproved();
        if (block.timestamp >= settlement.expiresAt) revert SettlementExpired();
        _requireCurrentClearance(settlement);

        approvedInRound[id][msg.sender] = settlement.approvalRound;
        if (settlement.approvals == 0) {
            settlement.approver1 = msg.sender;
            settlement.approver1Epoch = roleMembershipEpoch[APPROVER_ROLE][msg.sender];
        } else {
            settlement.approver2 = msg.sender;
            settlement.approver2Epoch = roleMembershipEpoch[APPROVER_ROLE][msg.sender];
        }
        settlement.approvals += 1;
        uint8 required = requiredApprovals(id);
        if (settlement.approvals >= required) settlement.state = State.Approved;
        emit SettlementApproved(
            id,
            msg.sender,
            settlement.approvals,
            required,
            settlement.approvalRound,
            roleMembershipEpoch[APPROVER_ROLE][msg.sender]
        );
    }

    /// @notice Lets the payer recover from an approver role revocation without changing the signed intent.
    function resetSettlementApprovals(uint256 id) external whenNotPaused {
        Settlement storage settlement = settlements[id];
        if (msg.sender != settlement.payer) revert NotPayer();
        if (settlement.state != State.Proposed && settlement.state != State.Approved) revert NotCancellable();
        _requireCurrentClearance(settlement);
        _resetApprovals(settlement);
        emit SettlementApprovalsReset(id, settlement.approvalRound);
    }

    function fundSettlement(uint256 id) external nonReentrant whenNotPaused {
        Settlement storage settlement = settlements[id];
        if (settlement.state != State.Approved) revert InvalidState(State.Approved, settlement.state);
        if (msg.sender != settlement.payer) revert NotPayer();
        if (block.timestamp + minimumChallengeWindow >= settlement.expiresAt) revert SettlementExpired();
        if (block.timestamp >= settlement.quoteValidUntil) revert QuoteExpired();
        if (!_isCleanParticipant(settlement.payer) || !_isCleanParticipant(settlement.beneficiary)) revert ConflictOfInterest();
        _requireCurrentClearance(settlement);
        _requireLiveApprovals(settlement);

        uint256 day = block.timestamp / 1 days;
        uint256 newDailySpend = spentPerDay[msg.sender][day] + settlement.amount;
        if (newDailySpend > dailyLimit) revert DailyLimitExceeded();

        Clearance storage clearance = clearances[settlement.clearanceId];
        if (uint256(clearance.consumedAmount) + settlement.amount > clearance.maxAmount) revert ClearanceInvalid();

        uint256 balanceBefore = stablecoin.balanceOf(address(this));
        stablecoin.safeTransferFrom(msg.sender, address(this), settlement.amount);
        if (stablecoin.balanceOf(address(this)) - balanceBefore != settlement.amount) revert DeflationaryAssetUnsupported();

        spentPerDay[msg.sender][day] = newDailySpend;
        clearance.consumedAmount += settlement.amount;
        totalEscrowed += settlement.amount;
        settlement.fundedAt = uint48(block.timestamp);
        settlement.releaseAfter = uint48(block.timestamp + minimumChallengeWindow);
        settlement.state = State.Funded;
        emit ClearanceConsumptionChanged(settlement.clearanceId, clearance.consumedAmount, clearance.maxAmount);
        emit SettlementFunded(id, settlement.amount, settlement.fundedAt, settlement.releaseAfter);
    }

    function releaseSettlement(uint256 id) external nonReentrant whenNotPaused {
        Settlement storage settlement = settlements[id];
        if (settlement.state != State.Funded) revert InvalidState(State.Funded, settlement.state);
        if (block.timestamp < settlement.releaseAfter) revert ReleaseNotReady();
        if (block.timestamp >= settlement.expiresAt) revert SettlementExpired();
        if (!_isCleanParticipant(settlement.payer) || !_isCleanParticipant(settlement.beneficiary)) revert ConflictOfInterest();
        _requireCurrentClearance(settlement);
        _requireLiveApprovals(settlement);

        uint256 balanceBefore = stablecoin.balanceOf(settlement.beneficiary);
        settlement.state = State.Released;
        totalEscrowed -= settlement.amount;
        stablecoin.safeTransfer(settlement.beneficiary, settlement.amount);
        if (stablecoin.balanceOf(settlement.beneficiary) - balanceBefore != settlement.amount) {
            revert DeflationaryAssetUnsupported();
        }
        emit SettlementReleased(id, settlement.beneficiary, settlement.amount);
    }

    function cancelSettlement(uint256 id, bytes32 reasonDigest) external nonReentrant {
        Settlement storage settlement = settlements[id];
        if (msg.sender != settlement.payer && !hasRole(DEFAULT_ADMIN_ROLE, msg.sender)) revert UnauthorizedCancellation();
        _cancel(settlement, id, reasonDigest);
    }

    function rollbackExpired(uint256 id) external nonReentrant {
        Settlement storage settlement = settlements[id];
        if (block.timestamp < settlement.expiresAt) revert NotCancellable();
        _cancel(settlement, id, keccak256("EXPIRED"));
    }

    function verifyInvoiceDisclosure(uint256 id, bytes calldata invoiceData, bytes32 salt) external view returns (bool) {
        Settlement storage settlement = settlements[id];
        return computeInvoiceCommitment(
            settlement.payer,
            settlement.beneficiary,
            settlement.amount,
            settlement.corridorDigest,
            settlement.clientOrderId,
            invoiceData,
            salt
        ) == settlement.invoiceCommitment;
    }

    function escrowIsSolvent() external view returns (bool) {
        return stablecoin.balanceOf(address(this)) >= totalEscrowed;
    }

    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) { _pause(); }
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) { _unpause(); }

    function _requireCurrentClearance(Settlement storage settlement) internal view {
        Clearance memory clearance = clearances[settlement.clearanceId];
        SubjectRisk memory risk = subjectRisks[settlement.beneficiary];
        SubjectRisk memory payerRisk = subjectRisks[settlement.payer];
        if (payerRisk.sanctioned) revert PayerSanctioned();
        if (
            revokedClearances[settlement.clearanceId]
                || !payerRisk.initialized
                || payerRisk.epoch != settlement.payerRiskEpoch
                || payerRisk.epoch != clearance.payerRiskEpoch
        ) revert ClearanceVersionChanged();
        if (!_isUsableRiskAttestation(payerRisk) || !_isUsableRiskAttestation(risk)) revert ClearanceVersionChanged();
        if (risk.sanctioned) revert BeneficiarySanctioned();
        if (!risk.initialized || risk.epoch != clearance.subjectRiskEpoch) revert ClearanceVersionChanged();
        if (
            clearance.payer != settlement.payer
                || clearance.beneficiary != settlement.beneficiary
                || clearance.policyDigest != settlement.policyDigest
                || clearance.corridorDigest != settlement.corridorDigest
                || clearance.maxAmount < settlement.amount
                || clearance.validUntil < settlement.expiresAt
        ) revert ClearanceInvalid();
        if (
            !hasRole(COMPLIANCE_ROLE, clearance.issuer)
                || roleMembershipEpoch[COMPLIANCE_ROLE][clearance.issuer] != clearance.issuerEpoch
        ) revert ClearanceVersionChanged();
    }

    function _requireIntentClearance(SettlementIntent calldata intent) internal view {
        Clearance memory clearance = clearances[intent.clearanceId];
        SubjectRisk memory risk = subjectRisks[intent.beneficiary];
        SubjectRisk memory payerRisk = subjectRisks[intent.payer];
        if (!payerRisk.initialized || payerRisk.sanctioned) revert PayerSanctioned();
        if (!_isUsableRiskAttestation(payerRisk) || !_isUsableRiskAttestation(risk)) revert ClearanceVersionChanged();
        if (risk.sanctioned) revert BeneficiarySanctioned();
        if (
            revokedClearances[intent.clearanceId]
                || !risk.initialized
                || risk.epoch != clearance.subjectRiskEpoch
                || payerRisk.epoch != clearance.payerRiskEpoch
        ) revert ClearanceVersionChanged();
        if (
            clearance.payer != intent.payer
                || clearance.beneficiary != intent.beneficiary
                || clearance.policyDigest != intent.policyDigest
                || clearance.corridorDigest != intent.corridorDigest
                || clearance.maxAmount < intent.amount
                || clearance.validUntil < intent.expiresAt
        ) revert ClearanceInvalid();
        if (
            !hasRole(COMPLIANCE_ROLE, clearance.issuer)
                || roleMembershipEpoch[COMPLIANCE_ROLE][clearance.issuer] != clearance.issuerEpoch
        ) revert ClearanceVersionChanged();
    }

    function _requireLiveApprovals(Settlement storage settlement) internal view {
        if (!_isIndependentLiveApprover(settlement.approver1, settlement, settlement.approver1Epoch)) {
            revert ApprovalNoLongerValid();
        }
        if (settlement.amount >= highValueThreshold) {
            if (
                settlement.approver2 == settlement.approver1
                    || !_isIndependentLiveApprover(settlement.approver2, settlement, settlement.approver2Epoch)
            ) {
                revert ApprovalNoLongerValid();
            }
        }
    }

    function _isIndependentLiveApprover(address approver, Settlement storage settlement, uint64 expectedEpoch)
        internal view returns (bool)
    {
        return approver != address(0)
            && approver != settlement.payer
            && approver != settlement.beneficiary
            && hasRole(APPROVER_ROLE, approver)
            && roleMembershipEpoch[APPROVER_ROLE][approver] == expectedEpoch
            && !hasRole(DEFAULT_ADMIN_ROLE, approver)
            && !hasRole(OPERATOR_ROLE, approver)
            && !hasRole(COMPLIANCE_ROLE, approver);
    }

    function _isSeparatedRole(bytes32 role) internal pure returns (bool) {
        return role == DEFAULT_ADMIN_ROLE || role == OPERATOR_ROLE || role == APPROVER_ROLE || role == COMPLIANCE_ROLE;
    }

    function _isCleanParticipant(address account) internal view returns (bool) {
        return !hasRole(DEFAULT_ADMIN_ROLE, account)
            && !hasRole(OPERATOR_ROLE, account)
            && !hasRole(APPROVER_ROLE, account)
            && !hasRole(COMPLIANCE_ROLE, account);
    }

    function _isUsableRiskAttestation(SubjectRisk memory risk) internal view returns (bool) {
        if (risk.sanctioned) return true;
        return hasRole(COMPLIANCE_ROLE, risk.attestor)
            && roleMembershipEpoch[COMPLIANCE_ROLE][risk.attestor] == risk.attestorEpoch
            && block.timestamp <= uint256(risk.screenedAt) + RISK_ATTESTATION_MAX_AGE;
    }

    function _grantRole(bytes32 role, address account) internal override returns (bool) {
        bool changed = super._grantRole(role, account);
        if (changed && (role == APPROVER_ROLE || role == COMPLIANCE_ROLE)) {
            roleMembershipEpoch[role][account] += 1;
        }
        return changed;
    }

    function _revokeRole(bytes32 role, address account) internal override returns (bool) {
        bool changed = super._revokeRole(role, account);
        if (changed && (role == APPROVER_ROLE || role == COMPLIANCE_ROLE)) {
            roleMembershipEpoch[role][account] += 1;
        }
        return changed;
    }

    function _hashIntent(SettlementIntent calldata intent) internal view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(
            SETTLEMENT_INTENT_TYPEHASH,
            intent.payer,
            intent.beneficiary,
            intent.amount,
            intent.expiresAt,
            intent.quoteValidUntil,
            intent.clearanceId,
            intent.invoiceCommitment,
            intent.policyDigest,
            intent.corridorDigest,
            intent.quoteDigest,
            intent.clientOrderId,
            intent.nonce
        )));
    }

    function _resetApprovals(Settlement storage settlement) internal {
        settlement.approvalRound += 1;
        settlement.approvals = 0;
        settlement.approver1 = address(0);
        settlement.approver2 = address(0);
        settlement.approver1Epoch = 0;
        settlement.approver2Epoch = 0;
        settlement.state = State.Proposed;
    }

    function _cancel(Settlement storage settlement, uint256 id, bytes32 reasonDigest) internal {
        State prior = settlement.state;
        if (prior != State.Proposed && prior != State.Approved && prior != State.Funded) revert NotCancellable();
        settlement.state = State.Cancelled;
        uint256 refund = prior == State.Funded ? settlement.amount : 0;
        if (refund > 0) {
            uint256 balanceBefore = stablecoin.balanceOf(settlement.payer);
            Clearance storage clearance = clearances[settlement.clearanceId];
            clearance.consumedAmount -= settlement.amount;
            totalEscrowed -= refund;
            stablecoin.safeTransfer(settlement.payer, refund);
            if (stablecoin.balanceOf(settlement.payer) - balanceBefore != refund) revert DeflationaryAssetUnsupported();
            emit ClearanceConsumptionChanged(settlement.clearanceId, clearance.consumedAmount, clearance.maxAmount);
        }
        emit SettlementCancelled(id, msg.sender, reasonDigest, refund);
    }
}
