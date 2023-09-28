// SPDX-License-Identifier: MIT

pragma solidity 0.8.18;

import "./Ownable.sol";

abstract contract Pausable is Ownable {
    uint public lastPauseTime;
    bool public paused;

    event PauseChanged(bool isPaused);

    modifier notPaused {
        require(!paused, "Pausable: this action cannot be performed while the contract is paused");
        _;
    }

    constructor() {
        require(owner() != address(0), "Pausable: Owner must be set");
    }

    function setPaused(bool _paused) external onlyOwner {
        if (_paused == paused) {
            return;
        }

        paused = _paused;

        if (paused) {
            lastPauseTime = block.timestamp;
        }

        emit PauseChanged(paused);
    }
}