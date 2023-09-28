// SPDX-License-Identifier: MIT

pragma solidity 0.8.18;

import "../shared/IBEP20.sol";
import "../shared/ReentrancyGuard.sol";
import "../shared/Pausable.sol";

contract StakingRewards is ReentrancyGuard, Pausable {

    IBEP20 public immutable _rewardsToken;
    IBEP20 public immutable _stakingToken;
    uint256 public _periodFinish = 0;
    uint256 public _rewardRate = 0;
    uint256 public _rewardsDuration;
    uint256 public _lastUpdateTime;
    uint256 public _rewardPerTokenStored;
    uint256 private _totalSupply;

    mapping(address => uint256) public _userRewardPerTokenPaid;
    mapping(address => uint256) public _rewards;   
    mapping(address => uint256) private _balances;

    event RewardAdded(uint256 reward);
    event Staked(address indexed user, uint256 amount);
    event Withdrawn(address indexed user, uint256 amount);
    event RewardPaid(address indexed user, uint256 reward);
    event RewardsDurationUpdated(uint256 newDuration);
    event Recovered(address token, uint256 amount);

    modifier updateReward(address account) {
        _rewardPerTokenStored = rewardPerToken();
        _lastUpdateTime = lastTimeRewardApplicable();
        if (account != address(0)) {
            _rewards[account] = earned(account);
            _userRewardPerTokenPaid[account] = _rewardPerTokenStored;
        }
        _;
    }

    constructor(address rewardsToken, address stakingToken, uint256 rewardDuration) {
        _rewardsToken = IBEP20(rewardsToken);
        _stakingToken = IBEP20(stakingToken);
        _rewardsDuration = rewardDuration * 1 days;
    }

    receive() external payable {}

    fallback() external payable {}

    function totalSupply() external view returns (uint256) {
        return _totalSupply;
    }

    function balanceOf(address account) external view returns (uint256) {
        return _balances[account];
    }

    function lastTimeRewardApplicable() public view returns (uint256) {
        return block.timestamp < _periodFinish ? block.timestamp : _periodFinish;
    }

    function rewardPerToken() public view returns (uint256) {
        if (_totalSupply == 0) {
            return _rewardPerTokenStored;
        }

        return
            _rewardPerTokenStored + ( (lastTimeRewardApplicable() - _lastUpdateTime) * _rewardRate * 1e18 / _totalSupply );
    }

    function earned(address account) public view returns (uint256) {
        return _balances[account] * (rewardPerToken() - _userRewardPerTokenPaid[account])  / 1e18 + _rewards[account];
    }

    function getRewardForDuration() external view returns (uint256) {
        return _rewardRate * _rewardsDuration;
    }

    function stake(uint256 amount) external nonReentrant notPaused updateReward(msg.sender) {
        require(amount > 0, "StakingRewards: cannot stake 0");

        _totalSupply = _totalSupply + amount;
        _balances[msg.sender] = _balances[msg.sender] + amount;
        _stakingToken.transferFrom(msg.sender, address(this), amount);

        emit Staked(msg.sender, amount);
    }

    function withdraw(uint256 amount) public nonReentrant updateReward(msg.sender) {
        require(amount > 0, "StakingRewards: cannot withdraw 0");
        require(_balances[msg.sender] >= amount, "StakingRewards: cannot withdraw more than staked");

        _totalSupply = _totalSupply - amount;
        _balances[msg.sender] = _balances[msg.sender] - amount;
        _stakingToken.transfer(msg.sender, amount);

        emit Withdrawn(msg.sender, amount);
    }

    function getReward() public nonReentrant updateReward(msg.sender) {
        uint256 reward = _rewards[msg.sender];
        if (reward > 0) {
            _rewards[msg.sender] = 0;
            _rewardsToken.transfer(msg.sender, reward);
            emit RewardPaid(msg.sender, reward);
        }
    }

    function exit() external {
        withdraw(_balances[msg.sender]);
        getReward();
    }

    function notifyRewardAmount(uint256 reward) external onlyOwner updateReward(address(0)) {
        if (block.timestamp >= _periodFinish) {
            _rewardRate = reward / _rewardsDuration;
        } else {
            uint256 remaining = _periodFinish - block.timestamp;
            uint256 leftover = remaining * _rewardRate;
            _rewardRate = (reward + leftover) / _rewardsDuration;
        }

        // Ensure the provided reward amount is not more than the balance in the contract.
        uint balance = _rewardsToken.balanceOf(address(this));
        require(_rewardRate <= balance / _rewardsDuration, "StakingRewards: provided reward too high");

        _lastUpdateTime = block.timestamp;
        _periodFinish = block.timestamp + _rewardsDuration;

        emit RewardAdded(reward);
    }

    // Added to support to recover various tokens sent to this contract
    function recover(address tokenAddress, uint256 tokenAmount) external onlyOwner {
        require(tokenAddress != address(_stakingToken), "StakingRewards: cannot withdraw the staking token");

        IBEP20(tokenAddress).transfer(owner(), tokenAmount);

        emit Recovered(tokenAddress, tokenAmount);
    }

    function setRewardsDuration(uint256 rewardsDuration) external onlyOwner {
        require(block.timestamp > _periodFinish, "StakingRewards: previous rewards period must be complete before changing the duration for the new period");

        _rewardsDuration = rewardsDuration * 1 days;

        emit RewardsDurationUpdated(_rewardsDuration);
    }
}
