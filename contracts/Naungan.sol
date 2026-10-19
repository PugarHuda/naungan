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
        uint256 quorum; // fresh above-threshold reports needed from distinct oracles to trigger
        uint256 groupId;
        uint256 amountPerHousehold;
        uint256 triggerThreshold;
        uint256 claimWindow;
        uint256 claimDeadline; // 0 until triggered
        uint256 lastIndex;
        uint256 enrolled;
        uint256 funded;
        uint256 claims;
        uint256 seasonEnd; // monitoring stops; if never triggered, the pool is refundable after this
    }

    struct Report {
        uint128 value;
        uint64 at;
    }

    uint256 public constant MAX_ORACLES = 16;
    /// A report counts toward the quorum for this long, so oracles must agree on the same forecast cycle.
    uint256 public constant REPORT_TTL = 1 days;

    ISemaphore public immutable semaphore;
    IERC20 public immutable token;

    uint256 public programCount;
    mapping(uint256 => Program) public programs;
    mapping(uint256 => mapping(address => bool)) public isAgency;
    mapping(uint256 => string) public metadata;
    // Leaves of each program's Semaphore group, in insertion order, so a phone can rebuild the
    // Merkle tree with one eth_call instead of scanning months of logs on a rate-limited RPC.
    mapping(uint256 => uint256[]) internal _members;
    mapping(uint256 => address[]) internal _oracles;
    mapping(uint256 => mapping(address => bool)) public isOracle;
    mapping(uint256 => mapping(address => Report)) public reports;
    // ponytail: own nullifier set instead of semaphore.validateProof, which anyone can call
    // with a leaked proof to burn the nullifier before the real claim lands.
    mapping(uint256 => mapping(uint256 => bool)) public nullifierUsed;
    /// What each donor put into each program, so leftovers go back to the people who gave them.
    mapping(uint256 => mapping(address => uint256)) public contributed;

    /// @param metadata JSON describing the hazard, location and data source, so anyone can audit the trigger.
    event ProgramCreated(uint256 indexed programId, address coordinator, uint256 amountPerHousehold, uint256 triggerThreshold, string metadata);
    event AgencyAdded(uint256 indexed programId, address agency);
    event AgencyRemoved(uint256 indexed programId, address agency);
    event Enrolled(uint256 indexed programId, address indexed agency, uint256 households);
    event Funded(uint256 indexed programId, address indexed donor, uint256 amount);
    /// @param evidence how the value was computed (source, forecast run, inputs), recorded for audit.
    /// @param agreeing distinct oracles whose fresh report is at or above the threshold, this one included.
    event IndexReported(uint256 indexed programId, address oracle, uint256 value, uint256 agreeing, bool triggered, string evidence);
    event Claimed(uint256 indexed programId, uint256 nullifier, address payout);
    event Refunded(uint256 indexed programId, address indexed donor, uint256 amount);

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
    error UnknownProgram();
    error SeasonOver();
    error BadParams();
    error NothingToRefund();

    constructor(ISemaphore _semaphore, IERC20 _token) {
        semaphore = _semaphore;
        token = _token;
    }

    /// @param oracles_ independent reporters (e.g. different operators or data pipelines)
    /// @param quorum how many of them must report at/above the threshold within REPORT_TTL to trigger
    function createProgram(
        address[] calldata oracles_,
        uint256 quorum,
        uint256 amountPerHousehold,
        uint256 triggerThreshold,
        uint256 claimWindow,
        uint256 seasonEnd,
        string calldata metadata_
    ) external returns (uint256 programId) {
        if (
            quorum == 0 || quorum > oracles_.length || oracles_.length > MAX_ORACLES || amountPerHousehold == 0 ||
            triggerThreshold == 0 || claimWindow == 0 || seasonEnd <= block.timestamp
        ) revert BadParams();
        programId = ++programCount;
        for (uint256 i; i < oracles_.length; i++) {
            if (oracles_[i] == address(0) || isOracle[programId][oracles_[i]]) revert BadParams(); // zero or duplicate
            isOracle[programId][oracles_[i]] = true;
        }
        _oracles[programId] = oracles_;
        Program storage p = programs[programId];
        p.coordinator = msg.sender;
        p.quorum = quorum;
        p.amountPerHousehold = amountPerHousehold;
        p.triggerThreshold = triggerThreshold;
        p.claimWindow = claimWindow;
        p.seasonEnd = seasonEnd;
        metadata[programId] = metadata_;
        emit ProgramCreated(programId, msg.sender, amountPerHousehold, triggerThreshold, metadata_);
        p.groupId = semaphore.createGroup(address(this)); // external call last (checks-effects-interactions)
    }

    function addAgency(uint256 programId, address agency) external {
        if (msg.sender != programs[programId].coordinator) revert NotCoordinator();
        isAgency[programId][agency] = true;
        emit AgencyAdded(programId, agency);
    }

    /// @notice Revoke a compromised or departed agency. Households it already enrolled stay eligible.
    function removeAgency(uint256 programId, address agency) external {
        if (msg.sender != programs[programId].coordinator) revert NotCoordinator();
        isAgency[programId][agency] = false;
        emit AgencyRemoved(programId, agency);
    }

    /// @notice Agencies enroll only households that survived private cross-agency dedup (PSI).
    function enroll(uint256 programId, uint256[] calldata commitments) external {
        if (!isAgency[programId][msg.sender]) revert NotAgency();
        Program storage p = programs[programId];
        if (p.claimDeadline != 0) revert AlreadyTriggered();
        for (uint256 i; i < commitments.length; i++) _members[programId].push(commitments[i]);
        p.enrolled += commitments.length;
        emit Enrolled(programId, msg.sender, commitments.length);
        semaphore.addMembers(p.groupId, commitments); // reverts the whole tx on a duplicate or invalid leaf
    }

    function members(uint256 programId) external view returns (uint256[] memory) {
        return _members[programId];
    }

    function fund(uint256 programId, uint256 amount) external {
        Program storage p = programs[programId];
        if (p.coordinator == address(0)) revert UnknownProgram();
        // Closed programs take no money: it could never be claimed, and it would skew everyone's refund share.
        if (closed(p)) revert ClaimWindowClosed();
        p.funded += amount;
        contributed[programId][msg.sender] += amount;
        token.safeTransferFrom(msg.sender, address(this), amount);
        emit Funded(programId, msg.sender, amount);
    }

    function oracles(uint256 programId) external view returns (address[] memory) {
        return _oracles[programId];
    }

    /// @notice An oracle posts a hazard index (scripts/oracle.js: GloFAS ensemble probability, in %,
    /// that river discharge exceeds the program's return-period flood). Claims open once `quorum`
    /// distinct oracles hold a fresh report at or above the threshold, so no single key can trigger.
    function reportIndex(uint256 programId, uint256 value, string calldata evidence) external {
        Program storage p = programs[programId];
        if (!isOracle[programId][msg.sender]) revert NotOracle();
        if (p.claimDeadline != 0) revert AlreadyTriggered();
        if (block.timestamp > p.seasonEnd) revert SeasonOver();
        if (value > type(uint128).max) revert BadParams();
        reports[programId][msg.sender] = Report(uint128(value), uint64(block.timestamp));
        p.lastIndex = value;

        uint256 agreeing = 0;
        address[] storage os = _oracles[programId];
        for (uint256 i; i < os.length; i++) {
            Report memory r = reports[programId][os[i]];
            if (r.at != 0 && block.timestamp - r.at <= REPORT_TTL && r.value >= p.triggerThreshold) agreeing++;
        }
        bool triggered = agreeing >= p.quorum;
        // Never block the trigger on funding: an early partial payout beats a late full one.
        if (triggered) p.claimDeadline = block.timestamp + p.claimWindow;
        emit IndexReported(programId, msg.sender, value, agreeing, triggered, evidence);
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

    /// @notice Once the claim window closes (or the season ends without a trigger), each donor takes
    /// back their pro-rata share of what was not paid out. Pull-based: nobody can redirect a donor's
    /// money, and the coordinator never holds it. After closing, `funded` and `claims` are frozen,
    /// so every donor's share is computed from the same totals.
    function refund(uint256 programId) external {
        Program storage p = programs[programId];
        if (!closed(p)) revert ClaimWindowOpen();
        uint256 gave = contributed[programId][msg.sender];
        if (gave == 0) revert NothingToRefund();
        contributed[programId][msg.sender] = 0;
        // ponytail: floor division leaves at most (donors - 1) base units of dust in the contract
        uint256 owed = gave * (p.funded - p.claims * p.amountPerHousehold) / p.funded;
        token.safeTransfer(msg.sender, owed);
        emit Refunded(programId, msg.sender, owed);
    }

    /// Claims (or, without a trigger, the season) are over for good.
    function closed(Program storage p) internal view returns (bool) {
        if (p.coordinator == address(0)) return false;
        return p.claimDeadline == 0 ? block.timestamp > p.seasonEnd : block.timestamp > p.claimDeadline;
    }
}
