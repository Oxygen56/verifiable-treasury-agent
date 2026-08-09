// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.28;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title VerifiableTreasury
/// @notice Escrows ERC-20 settlements behind explicit limits, approvals and compliance attestations.
/// @dev Raw invoice, identity and sanctions data must remain off-chain. Only commitments/digests belong here.
contract VerifiableTreasury is AccessControl, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");
    bytes32 public constant APPROVER_ROLE = keccak256("APPROVER_ROLE");
    bytes32 public constant COMPLIANCE_ROLE = keccak256("COMPLIANCE_ROLE");

    enum State { None, Proposed, Approved, Funded, Released, Cancelled }

    struct Settlement {
        address payer;
        address beneficiary;
        uint128 amount;
        uint48 createdAt;
        uint48 releaseAfter;
        uint48 expiresAt;
        bytes32 invoiceCommitment;
        bytes32 policyDigest;
        State state;
        uint8 approvals;
    }

    struct Clearance {
        bytes32 policyDigest;
        uint48 validUntil;
        bool sanctioned;
    }

    IERC20 public immutable stablecoin;
    uint256 public immutable dailyLimit;
    uint256 public immutable highValueThreshold;
    uint256 public immutable minimumChallengeWindow;
    uint256 public nextSettlementId = 1;

    mapping(uint256 => Settlement) public settlements;
    mapping(uint256 => mapping(address => bool)) public hasApproved;
    mapping(address => Clearance) public clearances;
    mapping(address => mapping(uint256 => uint256)) public spentPerDay;

    event ClearanceRecorded(address indexed beneficiary, bytes32 indexed policyDigest, uint48 validUntil, bool sanctioned);
    event SettlementProposed(uint256 indexed id, address indexed payer, address indexed beneficiary, uint256 amount, bytes32 invoiceCommitment, bytes32 policyDigest);
    event SettlementApproved(uint256 indexed id, address indexed approver, uint8 approvals, uint8 requiredApprovals);
    event SettlementFunded(uint256 indexed id, uint256 amount);
    event SettlementReleased(uint256 indexed id, address indexed beneficiary, uint256 amount);
    event SettlementCancelled(uint256 indexed id, address indexed actor, bytes32 indexed reasonDigest, uint256 refundedAmount);

    error InvalidState(State expected, State actual);
    error InvalidSchedule();
    error InvalidAmount();
    error InvalidCommitment();
    error ClearanceInvalid();
    error BeneficiarySanctioned();
    error AlreadyApproved();
    error NotPayer();
    error NotCancellable();
    error ReleaseNotReady();
    error SettlementExpired();
    error DailyLimitExceeded();
    error UnauthorizedCancellation();

    constructor(
        IERC20 stablecoin_,
        address admin,
        uint256 dailyLimit_,
        uint256 highValueThreshold_,
        uint256 minimumChallengeWindow_
    ) {
        if (address(stablecoin_) == address(0) || admin == address(0)) revert InvalidAmount();
        stablecoin = stablecoin_;
        dailyLimit = dailyLimit_;
        highValueThreshold = highValueThreshold_;
        minimumChallengeWindow = minimumChallengeWindow_;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(OPERATOR_ROLE, admin);
        _grantRole(APPROVER_ROLE, admin);
        _grantRole(COMPLIANCE_ROLE, admin);
    }

    function recordClearance(address beneficiary, bytes32 policyDigest, uint48 validUntil, bool sanctioned)
        external onlyRole(COMPLIANCE_ROLE)
    {
        if (beneficiary == address(0) || policyDigest == bytes32(0) || validUntil <= block.timestamp) revert ClearanceInvalid();
        clearances[beneficiary] = Clearance(policyDigest, validUntil, sanctioned);
        emit ClearanceRecorded(beneficiary, policyDigest, validUntil, sanctioned);
    }

    function proposeSettlement(
        address payer,
        address beneficiary,
        uint128 amount,
        uint48 releaseAfter,
        uint48 expiresAt,
        bytes32 invoiceCommitment,
        bytes32 policyDigest
    ) external onlyRole(OPERATOR_ROLE) whenNotPaused returns (uint256 id) {
        if (payer == address(0) || beneficiary == address(0) || amount == 0) revert InvalidAmount();
        if (invoiceCommitment == bytes32(0) || policyDigest == bytes32(0)) revert InvalidCommitment();
        if (releaseAfter < block.timestamp + minimumChallengeWindow || expiresAt <= releaseAfter) revert InvalidSchedule();

        Clearance memory clearance = clearances[beneficiary];
        if (clearance.sanctioned) revert BeneficiarySanctioned();
        if (clearance.policyDigest != policyDigest || clearance.validUntil < expiresAt) revert ClearanceInvalid();

        id = nextSettlementId++;
        settlements[id] = Settlement({
            payer: payer,
            beneficiary: beneficiary,
            amount: amount,
            createdAt: uint48(block.timestamp),
            releaseAfter: releaseAfter,
            expiresAt: expiresAt,
            invoiceCommitment: invoiceCommitment,
            policyDigest: policyDigest,
            state: State.Proposed,
            approvals: 0
        });
        emit SettlementProposed(id, payer, beneficiary, amount, invoiceCommitment, policyDigest);
    }

    function requiredApprovals(uint256 id) public view returns (uint8) {
        Settlement storage settlement = settlements[id];
        return settlement.amount >= highValueThreshold ? 2 : 1;
    }

    function approveSettlement(uint256 id) external onlyRole(APPROVER_ROLE) whenNotPaused {
        Settlement storage settlement = settlements[id];
        if (settlement.state != State.Proposed) revert InvalidState(State.Proposed, settlement.state);
        if (hasApproved[id][msg.sender]) revert AlreadyApproved();
        _requireCurrentClearance(settlement);

        hasApproved[id][msg.sender] = true;
        settlement.approvals += 1;
        uint8 required = requiredApprovals(id);
        if (settlement.approvals >= required) settlement.state = State.Approved;
        emit SettlementApproved(id, msg.sender, settlement.approvals, required);
    }

    function fundSettlement(uint256 id) external nonReentrant whenNotPaused {
        Settlement storage settlement = settlements[id];
        if (settlement.state != State.Approved) revert InvalidState(State.Approved, settlement.state);
        if (msg.sender != settlement.payer) revert NotPayer();
        if (block.timestamp >= settlement.expiresAt) revert SettlementExpired();
        _requireCurrentClearance(settlement);

        uint256 day = block.timestamp / 1 days;
        uint256 newDailySpend = spentPerDay[msg.sender][day] + settlement.amount;
        if (newDailySpend > dailyLimit) revert DailyLimitExceeded();

        spentPerDay[msg.sender][day] = newDailySpend;
        settlement.state = State.Funded;
        stablecoin.safeTransferFrom(msg.sender, address(this), settlement.amount);
        emit SettlementFunded(id, settlement.amount);
    }

    function releaseSettlement(uint256 id) external nonReentrant whenNotPaused {
        Settlement storage settlement = settlements[id];
        if (settlement.state != State.Funded) revert InvalidState(State.Funded, settlement.state);
        if (block.timestamp < settlement.releaseAfter) revert ReleaseNotReady();
        if (block.timestamp >= settlement.expiresAt) revert SettlementExpired();
        _requireCurrentClearance(settlement);

        settlement.state = State.Released;
        stablecoin.safeTransfer(settlement.beneficiary, settlement.amount);
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
        return keccak256(abi.encode(invoiceData, salt)) == settlements[id].invoiceCommitment;
    }

    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) { _pause(); }
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) { _unpause(); }

    function _requireCurrentClearance(Settlement storage settlement) internal view {
        Clearance memory clearance = clearances[settlement.beneficiary];
        if (clearance.sanctioned) revert BeneficiarySanctioned();
        if (clearance.policyDigest != settlement.policyDigest || clearance.validUntil < settlement.expiresAt) revert ClearanceInvalid();
    }

    function _cancel(Settlement storage settlement, uint256 id, bytes32 reasonDigest) internal {
        State prior = settlement.state;
        if (prior != State.Proposed && prior != State.Approved && prior != State.Funded) revert NotCancellable();
        settlement.state = State.Cancelled;
        uint256 refund = prior == State.Funded ? settlement.amount : 0;
        if (refund > 0) stablecoin.safeTransfer(settlement.payer, refund);
        emit SettlementCancelled(id, msg.sender, reasonDigest, refund);
    }
}
