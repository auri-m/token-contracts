// SPDX-License-Identifier: MIT

pragma solidity 0.8.18;

import "../shared/ReentrancyGuard.sol";
import "../shared/Ownable.sol";
import "../shared/IBEP20.sol";

contract VestingWallet is Ownable, ReentrancyGuard {

    struct VestingSchedule {

        bool initialized;

        address beneficiary;

        // cliff period in seconds
        uint256 cliff;

        // start time of the vesting period
        uint256 start;

        // duration of the vesting period in seconds
        uint256 duration;

        // duration of a slice period for the vesting in seconds
        uint256 slicePeriod;

        bool revocable;

        uint256 amountTotal;

        // amount of tokens released
        uint256 released;

        // whether or not the vesting has been revoked
        bool revoked;
    }

    IBEP20 private immutable _token;
    bytes32[] private _vestingSchedulesIds;
    mapping(bytes32 => VestingSchedule) private _vestingSchedules;
    uint256 private _vestingSchedulesTotalAmount;
    mapping(address => uint256) private _beneficiaryVestingSchedulesCount;

    modifier onlyIfVestingScheduleNotRevoked(bytes32 vestingScheduleId) {
        require(_vestingSchedules[vestingScheduleId].initialized);
        require(!_vestingSchedules[vestingScheduleId].revoked);
        _;
    }

    constructor(address token) {
        require(token != address(0x0));
        _token = IBEP20(token);
    }

    receive() external payable {}

    fallback() external payable {}

    function getOwner() external view returns (address) {
        return owner();
    }

    function createVestingSchedule(
        address beneficiary, 
        uint256 start, 
        uint256 cliff, 
        uint256 duration, 
        uint256 slicePeriod, 
        bool revocable, 
        uint256 amount
    ) external onlyOwner {
        require(getWithdrawableAmount() >= amount, "VestingWallet: not enough tokens in the wallet");
        require(duration > 0, "VestingWallet: invalid duration");
        require(amount > 0, "VestingWallet: invalid amount");
        require(slicePeriod >= 1, "VestingWallet: invalid slice period");
        require(duration >= cliff, "VestingWallet: duration and clif incompatible");

        bytes32 vestingScheduleId = computeNextVestingScheduleIdForHolder(beneficiary);
        uint256 totalCliff = start + cliff;

        _vestingSchedules[vestingScheduleId] = VestingSchedule(
            true,
            beneficiary,
            totalCliff,
            start,
            duration,
            slicePeriod,
            revocable,
            amount,
            0,
            false
        );
        _vestingSchedulesIds.push(vestingScheduleId);
        _vestingSchedulesTotalAmount = _vestingSchedulesTotalAmount + amount;
        
        uint256 currentVestingCount = _beneficiaryVestingSchedulesCount[beneficiary];
        _beneficiaryVestingSchedulesCount[beneficiary] = currentVestingCount + 1;
    }

    function revoke(bytes32 vestingScheduleId) external onlyOwner onlyIfVestingScheduleNotRevoked(vestingScheduleId) {
        VestingSchedule storage vestingSchedule = _vestingSchedules[vestingScheduleId];

        require(vestingSchedule.revocable, "VestingWallet: vesting is not revocable");

        uint256 vestedAmount = _computeReleasableAmount(vestingSchedule);
        if (vestedAmount > 0) {
            release(vestingScheduleId, vestedAmount);
        }
        
        uint256 unreleased = vestingSchedule.amountTotal - vestingSchedule.released;
        _vestingSchedulesTotalAmount = _vestingSchedulesTotalAmount - unreleased;
        vestingSchedule.revoked = true;
    }

    function withdraw(uint256 amount) external nonReentrant onlyOwner {
        require(getWithdrawableAmount() >= amount, "VestingWallet: not enough withdrawable funds");

        _token.transfer(msg.sender, amount);
    }

    function releaseMultiple(bytes32[] memory scheduleIds, uint256[] memory amounts) public {
        require(scheduleIds.length == amounts.length, "VestingWallet: array size mismatch");

        for (uint256 i = 0; i < scheduleIds.length; i++) {
            release(scheduleIds[i], amounts[i]);
        }
    }
   
    function release(bytes32 vestingScheduleId, uint256 amount) public nonReentrant onlyIfVestingScheduleNotRevoked(vestingScheduleId) {
        VestingSchedule storage vestingSchedule = _vestingSchedules[vestingScheduleId];

        bool isBeneficiary = msg.sender == vestingSchedule.beneficiary;
        bool isOwner = (msg.sender == owner());
        require(isBeneficiary || isOwner, "VestingWallet: only beneficiary or owner can release vested tokens");

        uint256 vestedAmount = _computeReleasableAmount(vestingSchedule);
        require(vestedAmount >= amount, "VestingWallet: cannot release tokens, not enough vested tokens");

        vestingSchedule.released = vestingSchedule.released + amount;
        address payable beneficiaryPayable = payable(vestingSchedule.beneficiary);
        _vestingSchedulesTotalAmount = _vestingSchedulesTotalAmount - amount;
        _token.transfer(beneficiaryPayable, amount);
    }

    function getVestingSchedulesCountByBeneficiary(address beneficiary) external view returns (uint256) {
        return _beneficiaryVestingSchedulesCount[beneficiary];
    }

    function getVestingIdAtIndex(uint256 index) external view returns (bytes32) {
        require(index < getVestingSchedulesCount(), "VestingWallet: index out of bounds");
        return _vestingSchedulesIds[index];
    }

    function getVestingScheduleByAddressAndIndex(address holder, uint256 index) external view returns (VestingSchedule memory) {
        return getVestingSchedule(computeVestingScheduleIdForAddressAndIndex(holder, index));
    }

    function getVestingSchedulesTotalAmount() external view returns (uint256) {
        return _vestingSchedulesTotalAmount;
    }

    function getToken() external view returns (address) {
        return address(_token);
    }

    function getVestingSchedulesCount() public view returns (uint256) {
        return _vestingSchedulesIds.length;
    }

    function computeReleasableAmount(bytes32 vestingScheduleId) external view onlyIfVestingScheduleNotRevoked(vestingScheduleId) returns (uint256) {
        VestingSchedule storage vestingSchedule = _vestingSchedules[vestingScheduleId];
        return _computeReleasableAmount(vestingSchedule);
    }

    function getVestingSchedule(bytes32 vestingScheduleId) public view returns (VestingSchedule memory) {
        return _vestingSchedules[vestingScheduleId];
    }

    function getWithdrawableAmount() public view returns (uint256) {
        return _token.balanceOf(address(this)) - _vestingSchedulesTotalAmount;
    }

    function computeNextVestingScheduleIdForHolder(address holder) public view returns (bytes32) {
        return computeVestingScheduleIdForAddressAndIndex(holder, _beneficiaryVestingSchedulesCount[holder]);
    }

    function computeVestingScheduleIdForAddressAndIndex(address holder, uint256 index) public pure returns (bytes32) {
        return keccak256(abi.encodePacked(holder, index));
    }

    function _computeReleasableAmount(VestingSchedule memory vestingSchedule) internal view returns (uint256) {
        // Retrieve the current time.
        uint256 currentTime = getCurrentTime();

        // If the current time is before the cliff, no tokens are releasable.
        if ((currentTime < vestingSchedule.cliff) || vestingSchedule.revoked) {
            return 0;
        }
        // If the current time is after the vesting period, all tokens are releasable,
        // minus the amount already released.
        else if (currentTime >= vestingSchedule.start + vestingSchedule.duration) {
            return vestingSchedule.amountTotal - vestingSchedule.released;
        }
        // Otherwise, some tokens are releasable.
        else {
            // Compute the number of full vesting periods that have elapsed.
            uint256 timeFromStart = currentTime - vestingSchedule.start;
            uint256 secondsPerSlice = vestingSchedule.slicePeriod;
            uint256 vestedSlicePeriods = timeFromStart / secondsPerSlice;
            uint256 vestedSeconds = vestedSlicePeriods * secondsPerSlice;

            // Compute the amount of tokens that are vested.
            uint256 vestedAmount = (vestingSchedule.amountTotal * vestedSeconds) / vestingSchedule.duration;

            // Subtract the amount already released and return.
            return vestedAmount - vestingSchedule.released;
        }
    }

    function getCurrentTime() internal view virtual returns (uint256) {
        return block.timestamp;
    }
}
