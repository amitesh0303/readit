# Token Vesting and Staking Contracts: Architecture and Patterns

**Track:** Intermediate  
**Read time:** 12 min

---

## The Problem

You've launched a token. Now you need to distribute it responsibly — team tokens that vest over 4 years, investor tokens with a 1-year cliff, community rewards that accrue over time. You also want users to stake tokens to earn protocol fees or governance rights.

These sound simple but have real complexity: what happens if a team member leaves before their cliff? How do you handle staking rewards without running out of gas on large user bases? How do you prevent reward manipulation? This blog covers production-grade vesting and staking patterns used by real protocols.

---

## Core Concepts

### Vesting: The Core Mechanics

Vesting releases tokens gradually over time. The standard model:

```
Cliff: no tokens released until this date
Vesting period: tokens release linearly after the cliff
Total: cliff + vesting period

Example (standard startup vesting):
- Cliff: 1 year (0 tokens until month 12)
- Vesting: 3 years after cliff (linear release months 12-48)
- Total: 4 years

At month 0: 0 tokens claimable
At month 12: 25% claimable (cliff)
At month 24: 50% claimable
At month 36: 75% claimable
At month 48: 100% claimable
```

**Revocable vs irrevocable vesting:**
- Revocable: protocol/company can cancel unvested tokens (for employees)
- Irrevocable: once granted, tokens vest regardless (for investors, community)

### Staking: Reward Distribution Patterns

The naive approach — iterate over all stakers and distribute rewards — doesn't scale. With 10,000 stakers, a single reward distribution costs millions of gas.

The production solution: the "reward per token" accumulator pattern (pioneered by Synthetix, now standard across DeFi).

```
Key insight: instead of distributing to everyone, track a global
"rewardPerToken" that increases over time. Each user tracks their
"rewardPerTokenPaid" at their last interaction. The difference is
their unclaimed reward.

rewardPerToken increases continuously as rewards accrue.
User's pending reward = stakedAmount * (rewardPerToken - rewardPerTokenPaid)
```

This makes reward calculation O(1) per user regardless of total stakers.

### The Reward Per Token Formula

```
rewardPerToken += (rewardRate * elapsed) / totalStaked

User's earned = stakedBalance * (rewardPerToken - userRewardPerTokenPaid) + userRewardStored
```

Every time a user interacts (stake, unstake, claim), we:
1. Update the global `rewardPerToken`
2. Calculate and store the user's pending reward
3. Update the user's `rewardPerTokenPaid` to current `rewardPerToken`

---

## Code Walkthrough

**Vesting contract:**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

/**
 * @title VestingSchedule
 * @notice Token vesting with cliff, linear release, and optional revocation.
 */
contract VestingSchedule {
    struct Schedule {
        address beneficiary;
        uint256 totalAmount;      // total tokens to vest
        uint256 startTime;        // vesting start timestamp
        uint256 cliffDuration;    // seconds until first tokens unlock
        uint256 vestingDuration;  // seconds of linear vesting after cliff
        uint256 released;         // tokens already claimed
        bool revocable;           // can admin cancel this schedule?
        bool revoked;             // has it been revoked?
    }

    IERC20 public immutable token;
    address public immutable admin;

    mapping(bytes32 => Schedule) public schedules;
    mapping(address => bytes32[]) public beneficiarySchedules;

    event ScheduleCreated(bytes32 indexed scheduleId, address indexed beneficiary, uint256 amount);
    event TokensReleased(bytes32 indexed scheduleId, address indexed beneficiary, uint256 amount);
    event ScheduleRevoked(bytes32 indexed scheduleId, uint256 unvestedReturned);

    constructor(address _token) {
        token = IERC20(_token);
        admin = msg.sender;
    }

    /**
     * @notice Create a vesting schedule for a beneficiary.
     * @param beneficiary Address that will receive vested tokens
     * @param amount Total tokens to vest
     * @param startTime When vesting begins (can be in the past for backdating)
     * @param cliffDuration Seconds until first tokens unlock
     * @param vestingDuration Seconds of linear vesting after cliff
     * @param revocable Whether admin can cancel this schedule
     */
    function createSchedule(
        address beneficiary,
        uint256 amount,
        uint256 startTime,
        uint256 cliffDuration,
        uint256 vestingDuration,
        bool revocable
    ) external returns (bytes32 scheduleId) {
        require(msg.sender == admin, "Not admin");
        require(beneficiary != address(0), "Zero address");
        require(amount > 0, "Zero amount");
        require(vestingDuration > 0, "Zero duration");

        // Unique ID: hash of beneficiary + start + amount + nonce
        scheduleId = keccak256(
            abi.encodePacked(beneficiary, startTime, amount, block.timestamp)
        );
        require(schedules[scheduleId].totalAmount == 0, "Schedule exists");

        schedules[scheduleId] = Schedule({
            beneficiary: beneficiary,
            totalAmount: amount,
            startTime: startTime,
            cliffDuration: cliffDuration,
            vestingDuration: vestingDuration,
            released: 0,
            revocable: revocable,
            revoked: false
        });

        beneficiarySchedules[beneficiary].push(scheduleId);

        // Transfer tokens to this contract to hold in escrow
        token.transferFrom(msg.sender, address(this), amount);

        emit ScheduleCreated(scheduleId, beneficiary, amount);
    }

    /**
     * @notice Release vested tokens to beneficiary.
     * @param scheduleId The vesting schedule to release from
     */
    function release(bytes32 scheduleId) external {
        Schedule storage schedule = schedules[scheduleId];
        require(!schedule.revoked, "Schedule revoked");
        require(
            msg.sender == schedule.beneficiary || msg.sender == admin,
            "Not authorized"
        );

        uint256 releasable = vestedAmount(scheduleId) - schedule.released;
        require(releasable > 0, "Nothing to release");

        schedule.released += releasable;
        token.transfer(schedule.beneficiary, releasable);

        emit TokensReleased(scheduleId, schedule.beneficiary, releasable);
    }

    /**
     * @notice Revoke a vesting schedule (admin only, revocable schedules only).
     * @dev Releases vested tokens to beneficiary, returns unvested to admin.
     */
    function revoke(bytes32 scheduleId) external {
        require(msg.sender == admin, "Not admin");
        Schedule storage schedule = schedules[scheduleId];
        require(schedule.revocable, "Not revocable");
        require(!schedule.revoked, "Already revoked");

        // Release any vested but unclaimed tokens to beneficiary
        uint256 vested = vestedAmount(scheduleId);
        uint256 releasable = vested - schedule.released;
        if (releasable > 0) {
            schedule.released += releasable;
            token.transfer(schedule.beneficiary, releasable);
        }

        // Return unvested tokens to admin
        uint256 unvested = schedule.totalAmount - vested;
        schedule.revoked = true;

        if (unvested > 0) {
            token.transfer(admin, unvested);
        }

        emit ScheduleRevoked(scheduleId, unvested);
    }

    /**
     * @notice Calculate how many tokens have vested so far.
     * @return Total vested amount (including already released)
     */
    function vestedAmount(bytes32 scheduleId) public view returns (uint256) {
        Schedule memory schedule = schedules[scheduleId];
        if (schedule.revoked) return schedule.released; // no more vesting after revoke

        uint256 cliffEnd = schedule.startTime + schedule.cliffDuration;
        uint256 vestingEnd = cliffEnd + schedule.vestingDuration;

        if (block.timestamp < cliffEnd) {
            return 0; // before cliff: nothing vested
        } else if (block.timestamp >= vestingEnd) {
            return schedule.totalAmount; // fully vested
        } else {
            // Linear vesting between cliff and end
            uint256 elapsed = block.timestamp - cliffEnd;
            return (schedule.totalAmount * elapsed) / schedule.vestingDuration;
        }
    }
}
```

**Staking contract with reward-per-token accumulator:**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title StakingRewards
 * @notice Synthetix-style staking with O(1) reward distribution.
 * Users stake TOKEN, earn REWARD_TOKEN proportional to their share and time staked.
 */
contract StakingRewards {
    IERC20 public immutable stakingToken;
    IERC20 public immutable rewardToken;
    address public owner;

    // ─── Reward State ──────────────────────────────────────────────────────

    uint256 public rewardRate;          // reward tokens per second (total)
    uint256 public rewardsDuration;     // current reward period duration
    uint256 public periodFinish;        // when current reward period ends
    uint256 public lastUpdateTime;      // last time rewardPerToken was updated
    uint256 public rewardPerTokenStored; // accumulated reward per staked token

    // ─── User State ────────────────────────────────────────────────────────

    mapping(address => uint256) public userRewardPerTokenPaid; // snapshot at last interaction
    mapping(address => uint256) public rewards;                // pending unclaimed rewards
    mapping(address => uint256) public stakedBalance;

    uint256 public totalStaked;

    // ─── Events ────────────────────────────────────────────────────────────

    event Staked(address indexed user, uint256 amount);
    event Withdrawn(address indexed user, uint256 amount);
    event RewardClaimed(address indexed user, uint256 reward);
    event RewardAdded(uint256 reward, uint256 duration);

    constructor(address _stakingToken, address _rewardToken) {
        stakingToken = IERC20(_stakingToken);
        rewardToken = IERC20(_rewardToken);
        owner = msg.sender;
    }

    // ─── Modifiers ─────────────────────────────────────────────────────────

    /**
     * @dev Updates reward state before any user action.
     *      This is the core of the reward-per-token pattern.
     */
    modifier updateReward(address account) {
        // Update global accumulator
        rewardPerTokenStored = rewardPerToken();
        lastUpdateTime = lastTimeRewardApplicable();

        // Update user's pending reward
        if (account != address(0)) {
            rewards[account] = earned(account);
            userRewardPerTokenPaid[account] = rewardPerTokenStored;
        }
        _;
    }

    // ─── Core Functions ────────────────────────────────────────────────────

    function stake(uint256 amount) external updateReward(msg.sender) {
        require(amount > 0, "Cannot stake 0");
        totalStaked += amount;
        stakedBalance[msg.sender] += amount;
        stakingToken.transferFrom(msg.sender, address(this), amount);
        emit Staked(msg.sender, amount);
    }

    function withdraw(uint256 amount) external updateReward(msg.sender) {
        require(amount > 0, "Cannot withdraw 0");
        require(stakedBalance[msg.sender] >= amount, "Insufficient stake");
        totalStaked -= amount;
        stakedBalance[msg.sender] -= amount;
        stakingToken.transfer(msg.sender, amount);
        emit Withdrawn(msg.sender, amount);
    }

    function claimReward() external updateReward(msg.sender) {
        uint256 reward = rewards[msg.sender];
        if (reward > 0) {
            rewards[msg.sender] = 0;
            rewardToken.transfer(msg.sender, reward);
            emit RewardClaimed(msg.sender, reward);
        }
    }

    /**
     * @notice Convenience: withdraw all and claim rewards in one tx.
     */
    function exit() external {
        withdraw(stakedBalance[msg.sender]);
        claimReward();
    }

    // ─── View Functions ────────────────────────────────────────────────────

    /**
     * @notice Current reward per staked token (accumulated since deployment).
     * @dev This is the global accumulator. It only increases.
     */
    function rewardPerToken() public view returns (uint256) {
        if (totalStaked == 0) {
            return rewardPerTokenStored; // no stakers: accumulator doesn't move
        }
        return rewardPerTokenStored + (
            (lastTimeRewardApplicable() - lastUpdateTime) * rewardRate * 1e18 / totalStaked
        );
    }

    /**
     * @notice How many reward tokens a user has earned (including unclaimed).
     */
    function earned(address account) public view returns (uint256) {
        return (
            stakedBalance[account] *
            (rewardPerToken() - userRewardPerTokenPaid[account]) / 1e18
        ) + rewards[account];
    }

    function lastTimeRewardApplicable() public view returns (uint256) {
        return block.timestamp < periodFinish ? block.timestamp : periodFinish;
    }

    // ─── Admin ─────────────────────────────────────────────────────────────

    /**
     * @notice Fund a new reward period.
     * @param reward Total reward tokens to distribute
     * @param duration Duration of the reward period in seconds
     */
    function notifyRewardAmount(uint256 reward, uint256 duration)
        external
        updateReward(address(0))
    {
        require(msg.sender == owner, "Not owner");
        require(duration > 0, "Zero duration");

        rewardsDuration = duration;

        if (block.timestamp >= periodFinish) {
            // New period: set rate from scratch
            rewardRate = reward / duration;
        } else {
            // Extend existing period: add remaining rewards to new amount
            uint256 remaining = periodFinish - block.timestamp;
            uint256 leftover = remaining * rewardRate;
            rewardRate = (reward + leftover) / duration;
        }

        require(rewardRate > 0, "Reward rate too low");

        // Verify contract has enough reward tokens
        uint256 balance = rewardToken.balanceOf(address(this));
        require(rewardRate * duration <= balance, "Insufficient reward balance");

        lastUpdateTime = block.timestamp;
        periodFinish = block.timestamp + duration;

        emit RewardAdded(reward, duration);
    }
}

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}
```

---

## Common Mistakes and Gotchas

**1. Not updating `rewardPerToken` before every state change**  
The `updateReward` modifier must run before any change to `totalStaked` or `stakedBalance`. If you update balances first, the reward calculation uses the wrong denominator. This is why the modifier pattern is critical — it enforces the correct order.

**2. Vesting start time in the past**  
Some protocols backdate vesting schedules (e.g., "your vesting started when you joined, 6 months ago"). This is legitimate but requires careful handling — the beneficiary can immediately claim 6 months of vested tokens. Make sure this is intentional.

**3. Reward rate precision loss**  
`rewardRate = reward / duration` truncates. If `reward = 1000` and `duration = 3` seconds, `rewardRate = 333` (not 333.33). Over time, this means slightly less than `reward` total tokens are distributed. For large reward amounts and long durations, this is negligible. For small amounts, it can be significant. Some protocols use higher precision (1e18 multiplier on rewardRate).

**4. Not handling the case where `totalStaked = 0`**  
If no one is staking when rewards are being emitted, those rewards are lost (the accumulator doesn't move). Some protocols handle this by not starting the reward period until the first stake, or by sending unclaimed rewards back to the treasury.

**5. Revocable vesting without a timelock**  
If the admin can revoke vesting instantly, they can rug team members or investors. Consider adding a timelock to revocation — announce the revocation, wait 48 hours, then execute. This gives the beneficiary time to claim vested tokens.

---

## How This Connects to Production

Synthetix invented the reward-per-token staking pattern and it's now used by virtually every DeFi protocol with staking: Uniswap's liquidity mining, Curve's gauge system, Convex Finance, Aave's safety module, and hundreds of others. Compound's COMP distribution used a similar accumulator pattern. OpenZeppelin's `VestingWallet` contract is the standard for simple vesting. Gnosis Safe's vesting contracts are used by many DAOs for team token distribution. The combination of vesting (for token distribution) and staking (for protocol incentives) is the foundation of most DeFi tokenomics.

---

## What to Learn Next

- **Solana Token Program and SPL Tokens: The Equivalent of ERC-20** — see how token mechanics work on Solana.
- **What is DeFi? Lending, Borrowing, and Yield Explained** — revisit the broader DeFi context with this deeper understanding.
- **Access Control in Solidity: Ownable, Roles, and Multi-Sig** — secure your vesting and staking admin functions properly.
