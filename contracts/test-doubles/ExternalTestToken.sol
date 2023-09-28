// SPDX-License-Identifier: MIT

pragma solidity 0.8.18;

import "../shared/Context.sol";
import "../shared/Ownable.sol";
import "../shared/IBEP20.sol";

contract ExternalTestToken is Context, IBEP20, Ownable {
    mapping (address => uint256) private _balances;
    mapping (address => mapping (address => uint256)) private _allowances;

    uint256 private immutable _totalSupply;
    uint8 private immutable _decimals;
    string private _symbol;
    string private _name;

    constructor() {
        _name = "ExternalTestToken";
        _symbol = "EXT";
        _decimals = 18;
        _totalSupply = (1 * 10**6) * (10**_decimals); 

        _balances[msg.sender] = _totalSupply;
        emit Transfer(address(0), msg.sender, _totalSupply);
    }

    receive() external payable {}

    fallback() external payable {}

    function getOwner() external view returns (address) {
        return owner();
    }

    function decimals() external view returns (uint8) {
        return _decimals;
    }

    function symbol() external view returns (string memory) {
        return _symbol;
    }

    function name() external view returns (string memory) {
        return _name;
    }

    function totalSupply() external view returns (uint256) {
        return _totalSupply;
    }

    function balanceOf(address account) external view returns (uint256) {
        return _balances[account];
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        address owner = _msgSender();
        _transfer(owner, to, amount);

        return true;
    }

    function allowance(address owner, address spender) public view returns (uint256) {
        return _allowances[owner][spender];
    }

    function approve(address spender, uint256 amount) external returns (bool)  {
        address owner = _msgSender();
        _approve(owner, spender, amount);

        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        address spender  = _msgSender();
        _spendAllowance(from, spender, amount);
        _transfer(from, to, amount);

        return true;
    }

    function increaseAllowance(address spender, uint256 addedValue) public returns (bool) {
        require(addedValue > 0, "BEP20: invalid amount");

        address owner = _msgSender();
        _approve(owner, spender, allowance(owner, spender) + addedValue);

        return true;
    }

    function decreaseAllowance(address spender, uint256 subtractedValue) public returns (bool) {
        require(subtractedValue > 0, "BEP20: invalid amount");

        address owner = _msgSender();
        uint256 currentAllowance = allowance(owner, spender);
        require(currentAllowance >= subtractedValue, "BEP20: decreased allowance below zero");

        _approve(owner, spender, currentAllowance - subtractedValue);

        return true;
    }

    function _transfer(address from, address to, uint256 amount) internal {
        require(amount > 0, "BEP20: invalid amount");
        require(from != address(0), "BEP20: transfer from the zero address");
        require(to != address(0), "BEP20: transfer to the zero address");

        uint256 fromBalance = _balances[from];
        require(fromBalance >= amount, "BEP20: transfer amount exceeds balance");

        _balances[from] = fromBalance - amount;
        _balances[to] += amount;

        emit Transfer(from, to, amount);
    }

    function _approve(address owner, address spender, uint256 amount) internal {
        require(owner != address(0), "BEP20: approve from the zero address");
        require(spender != address(0), "BEP20: approve to the zero address");

        _allowances[owner][spender] = amount;

        emit Approval(owner, spender, amount);
    }

    function _spendAllowance(address owner, address spender, uint256 amount) internal virtual {
        require(amount > 0, "BEP20: invalid amount");
        uint256 currentAllowance = allowance(owner, spender);
        if (currentAllowance != type(uint256).max) 
        {
          require(currentAllowance >= amount, "BEP20: insufficient allowance");
          _approve(owner, spender, currentAllowance - amount);
        }
    }
}