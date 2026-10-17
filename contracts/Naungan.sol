// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ISemaphore} from "@semaphore-protocol/contracts/interfaces/ISemaphore.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title Naungan: privacy-preserving, anticipatory humanitarian cash.
/// @notice Several agencies enroll already-deduplicated households into one shared program
/// as anonymous Semaphore commitments. When the oracle reports that a hazard index crossed
/// the program threshold, each household can claim once with a zero-knowledge proof.
/// The chain only ever sees commitments, nullifiers and aggregate counters, never who.
contract Naungan {
    using SafeERC20 for IERC20;

    struct Program {
        address coordinator;
        address oracle;
        uint256 groupId;
        uint256 amountPerHousehold;
        uint256 triggerThreshold;
        uint256 claimWindow;
        uint256 claimDeadline; // 0 until triggered
        uint256 lastIndex;
        uint256 enrolled;
        uint256 funded;
        uint256 claims;
    }

    ISemaphore public immutable semaphore;
    IERC20 public immutable token;

    uint256 public programCount;
    mapping(uint256 => Program) public programs;
    mapping(uint256 => mapping(address => bool)) public isAgency;
    // ponytail: own nullifier set instead of semaphore.validateProof, which anyone can call
    // with a leaked proof to burn the nullifier before the real claim lands.
    mapping(uint256 => mapping(uint256 => bool)) public nullifierUsed;

    event ProgramCreated(uint256 indexed programId, address coordinator, uint256 amountPerHousehold, uint256 triggerThreshold);
    event AgencyAdded(uint256 indexed programId, address agency);
    event Enrolled(uint256 indexed programId, address indexed agency, uint256 households);
    event Funded(uint256 indexed programId, address indexed donor, uint256 amount);
    event IndexReported(uint256 indexed programId, uint256 value, bool triggered);
    event Claimed(uint256 indexed programId, uint256 nullifier, address payout);
    event Refunded(uint256 indexed programId, uint256 amount);

    error NotCoordinator();
    error NotAgency();
    error NotOracle();
    error NotTriggered();
    error AlreadyTriggered();
    error ClaimWindowClosed();
    error ClaimWindowOpen();
    error WrongScope();
    error BadPayout();
    error AlreadyClaimed();
    error InvalidProof();
    error Underfunded();

    constructor(ISemaphore _semaphore, IERC20 _token) {
        semaphore = _semaphore;
        token = _token;
    }

    function createProgram(
        address oracle,
        uint256 amountPerHousehold,
        uint256 triggerThreshold,
        uint256 claimWindow
    ) external returns (uint256 programId) {
        programId = ++programCount;
        Program storage p = programs[programId];
        p.coordinator = msg.sender;
        p.oracle = oracle;
        p.groupId = semaphore.createGroup(address(this));
        p.amountPerHousehold = amountPerHousehold;
        p.triggerThreshold = triggerThreshold;
        p.claimWindow = claimWindow;
        emit ProgramCreated(programId, msg.sender, amountPerHousehold, triggerThreshold);
    }

    function addAgency(uint256 programId, address agency) external {
        if (msg.sender != programs[programId].coordinator) revert NotCoordinator();
        isAgency[programId][agency] = true;
        emit AgencyAdded(programId, agency);
    }

    /// @notice Agencies enroll only households that survived private cross-agency dedup (PSI).
    function enroll(uint256 programId, uint256[] calldata commitments) external {
        if (!isAgency[programId][msg.sender]) revert NotAgency();
        Program storage p = programs[programId];
        if (p.claimDeadline != 0) revert AlreadyTriggered();
        semaphore.addMembers(p.groupId, commitments);
        p.enrolled += commitments.length;
        emit Enrolled(programId, msg.sender, commitments.length);
    }

    function fund(uint256 programId, uint256 amount) external {
        programs[programId].funded += amount;
        token.safeTransferFrom(msg.sender, address(this), amount);
        emit Funded(programId, msg.sender, amount);
    }

    /// @notice Oracle posts a hazard index (e.g. forecast rainfall in mm). Crossing the
    /// threshold opens the claim window before the disaster peaks.
    function reportIndex(uint256 programId, uint256 value) external {
        Program storage p = programs[programId];
        if (msg.sender != p.oracle) revert NotOracle();
        if (p.claimDeadline != 0) revert AlreadyTriggered();
        p.lastIndex = value;
        bool triggered = value >= p.triggerThreshold;
        // Never block the trigger on funding: an early partial payout beats a late full one.
        if (triggered) p.claimDeadline = block.timestamp + p.claimWindow;
        emit IndexReported(programId, value, triggered);
    }

    /// @notice Anyone (e.g. a gas relayer) may submit; the payout address is bound inside
    /// the proof's message, so a relayer cannot redirect funds.
    function claim(uint256 programId, ISemaphore.SemaphoreProof calldata proof) external {
        Program storage p = programs[programId];
        if (p.claimDeadline == 0) revert NotTriggered();
        if (block.timestamp > p.claimDeadline) revert ClaimWindowClosed();
        if (proof.scope != programId) revert WrongScope();
        if (proof.message >> 160 != 0 || proof.message == 0) revert BadPayout();
        if (nullifierUsed[programId][proof.nullifier]) revert AlreadyClaimed();
        // Per-program accounting: one program can never spend another program's pool.
        if (p.funded < (p.claims + 1) * p.amountPerHousehold) revert Underfunded();
        if (!semaphore.verifyProof(p.groupId, proof)) revert InvalidProof();

        nullifierUsed[programId][proof.nullifier] = true;
        p.claims++;
        address payout = address(uint160(proof.message));
        token.safeTransfer(payout, p.amountPerHousehold);
        emit Claimed(programId, proof.nullifier, payout);
    }

    /// @notice Unclaimed funds go back to the coordinator after the window closes.
    function refundUnclaimed(uint256 programId) external {
        Program storage p = programs[programId];
        if (msg.sender != p.coordinator) revert NotCoordinator();
        if (p.claimDeadline == 0 || block.timestamp <= p.claimDeadline) revert ClaimWindowOpen();
        uint256 left = p.funded - p.claims * p.amountPerHousehold;
        p.funded = p.claims * p.amountPerHousehold;
        token.safeTransfer(msg.sender, left);
        emit Refunded(programId, left);
    }
}
