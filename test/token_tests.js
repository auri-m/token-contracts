const { expect } = require("chai")
const hre = require("hardhat")
const { PANIC_CODES } = require("@nomicfoundation/hardhat-chai-matchers/panic");

describe("BEP20Token Tests", () => {

    const expectedTokenName = "BEP Token X";
    const expectedTokenSymbol = "BTX";
    const expectedTokenDecimals = 18;
    const expectedTotalSupplyInWei = hre.ethers.BigNumber.from("120000000000000000000000000") // 120 000 000 main units

    let ownerAccount;
    let someOtherAccount1;
    let someOtherAccount2;
    let tokenContract;

    beforeEach(async () => {
        // fetching pre-configured hardhat accounts
        [
            ownerAccount,
            someOtherAccount1,
            someOtherAccount2
        ] = await hre.ethers.getSigners();
        const contractFactory = await hre.ethers.getContractFactory("BEP20Token");
        // during deployment to the local blockchain the 1st hardhat account is gonna be picked as the default owner
        tokenContract = await contractFactory.deploy();
        await tokenContract.deployed();
    });

    describe("After Deployment", async () => {

        it("should be deployed successfully", async () => {
            expect(tokenContract.address).to.not.be.null;
        });

        it("should have the correct owner", async () => {
            const onChainOwner = await tokenContract.getOwner();

            expect(onChainOwner).to.equal(ownerAccount.address);
        });

        it("should have the correct name", async () => {
            const onChainName = await tokenContract.name();

            expect(onChainName).to.equal(expectedTokenName);
        });

        it("should have the correct symbol", async () => {
            const onChainSymbol = await tokenContract.symbol();

            expect(onChainSymbol).to.equal(expectedTokenSymbol);
        });

        it("should have the correct decimals", async () => {
            const onChainDecimals = await tokenContract.decimals();

            expect(onChainDecimals).to.equal(expectedTokenDecimals);
        });

        it("should have the correct total supply", async () => {
            const onChainTotalSupply = await tokenContract.totalSupply();

            expect(onChainTotalSupply).to.equal(expectedTotalSupplyInWei);
        });

        it("contract owner should own all available tokens", async () => {
            const onChainOwnerBalance = await tokenContract.balanceOf(ownerAccount.address);

            expect(onChainOwnerBalance).to.equal(expectedTotalSupplyInWei);
        });

        it("other accounts should own no tokens", async () => {
            const onChainSomeAccountBalance = await tokenContract.balanceOf(someOtherAccount1.address);

            expect(onChainSomeAccountBalance).to.equal(0);
        });

    })

    describe("BEP-20 Standard", async () => {

        describe("Transfers", async () => {

            const defaultAmountInWei = ethers.utils.parseEther("100");

            it("should allow a user to transfer tokens to another user", async () => {
                const sender = ownerAccount;
                const receiver = someOtherAccount1;

                // balances before transaction
                const senderBalanceBefore = await tokenContract.balanceOf(sender.address);
                const receiverBalanceBefore = await tokenContract.balanceOf(receiver.address);

                // transfer 
                await tokenContract.connect(sender).transfer(receiver.address, defaultAmountInWei);

                // balances after trasnaction
                const senderBalanceAfter = await tokenContract.balanceOf(sender.address);
                const receiverBalanceAfter = await tokenContract.balanceOf(receiver.address);

                expect(senderBalanceAfter).to.equal(senderBalanceBefore.sub(defaultAmountInWei));
                expect(receiverBalanceAfter).to.equal(receiverBalanceBefore.add(defaultAmountInWei));
            });

            it("should allow a user to transfer ALL of their tokens to another user", async () => {
                const sender = ownerAccount;
                const receiver = someOtherAccount1;

                const senderBalanceBefore = await tokenContract.balanceOf(sender.address);

                // transfer all tokens 
                await tokenContract.connect(sender).transfer(receiver.address, senderBalanceBefore);

                // balances after trasnaction
                const senderBalanceAfter = await tokenContract.balanceOf(sender.address);
                const receiverBalanceAfter = await tokenContract.balanceOf(receiver.address);

                expect(senderBalanceAfter).to.equal(0);
                expect(receiverBalanceAfter).to.equal(senderBalanceBefore);
            });

            it("should not allow a user to transfer more tokens than they have in their balance", async () => {
                const sender = someOtherAccount1;
                const receiver = someOtherAccount2;

                // confirm sender doesn't have any tokens 
                const senderBalanceBefore = await tokenContract.balanceOf(sender.address);
                const receivedBalanceBefore = await tokenContract.balanceOf(receiver.address);
                expect(senderBalanceBefore).to.equal(0);

                // try sending 100 from sender to receiver
                const transaction = tokenContract.connect(sender).transfer(receiver.address, defaultAmountInWei);

                // confirm transcation failed
                await expect(transaction).to.be.revertedWith("BEP20: transfer amount exceeds balance");

                // receivers balance remains unchanged
                const receivedBalanceAfter = await tokenContract.balanceOf(receiver.address);
                expect(receivedBalanceAfter).to.equal(receivedBalanceBefore);
            });

            it("should not change the balance if users transfers token to themselves", async () => {
                const sender = ownerAccount;

                const senderBalanceBefore = await tokenContract.balanceOf(sender.address);

                await tokenContract.connect(sender).transfer(sender.address, defaultAmountInWei);

                const senderBalanceAfter = await tokenContract.balanceOf(sender.address);

                expect(senderBalanceBefore).to.equal(senderBalanceAfter);
            });

            it("should not allow a users to transfer 0 tokens", async () => {
                const sender = ownerAccount;
                const receiver = someOtherAccount1;
                const negativeAmount = hre.ethers.BigNumber.from("0")
                const receivedBalanceBefore = await tokenContract.balanceOf(receiver.address);

                const transaction = tokenContract.connect(sender).transfer(receiver.address, negativeAmount);

                // confirm transcation failed
                await expect(transaction).to.be.revertedWith("BEP20: invalid amount");

                // receivers balance remains unchanged
                const receivedBalanceAfter = await tokenContract.balanceOf(receiver.address);
                expect(receivedBalanceAfter).to.equal(receivedBalanceBefore);
            });

            it("should emit a Transfer event with correct parameters", async () => {
                const sender = ownerAccount;
                const receiver = someOtherAccount1;
                const someAmount = ethers.utils.parseEther("22");

                // transfer transaction 
                const transaction = await tokenContract.connect(sender).transfer(receiver.address, someAmount);
                const receipt = await transaction.wait();

                // get transaction events
                const event = receipt.events.find(event => event.event === 'Transfer')
                const [
                    from,
                    to,
                    value
                ] = event.args;

                expect(from).to.equal(sender.address);
                expect(to).to.equal(receiver.address);
                expect(value).to.equal(someAmount);
            });
        })

        describe("Allowances", async () => {

            it('should allow the token owner to approve another user to spend tokens', async () => {

                const tokenOwner = ownerAccount;
                const tokenSpender = someOtherAccount1;
                const amountToApproveInWei = ethers.utils.parseEther("333");

                // approve "tokenSpender" to spend 333 tokens owned by "tokenOwner"
                await tokenContract.connect(tokenOwner).approve(tokenSpender.address, amountToApproveInWei);

                const approvedAmount = await tokenContract.allowance(tokenOwner.address, tokenSpender.address);
                expect(approvedAmount).to.equal(amountToApproveInWei)
            });

            it("should emit a Approval event with correct parameters", async () => {
                const tokenOwner = ownerAccount;
                const tokenSpender = someOtherAccount1;
                const amountToApproveInWei = ethers.utils.parseEther("4");

                // transfer transaction 
                const transaction = await tokenContract.connect(tokenOwner).approve(tokenSpender.address, amountToApproveInWei);
                const receipt = await transaction.wait();

                // get transaction events
                const event = receipt.events.find(event => event.event === 'Approval')
                const [
                    owner,
                    spender,
                    value
                ] = event.args;

                expect(owner).to.equal(tokenOwner.address);
                expect(spender).to.equal(tokenSpender.address);
                expect(value).to.equal(amountToApproveInWei);
            });

            it("should emit a Transfer event with correct parameters after transfering approved tokens ", async () => {
                const tokenOwner = ownerAccount;
                const tokenSpender = someOtherAccount1;
                const tokenReceiver = someOtherAccount2;
                const amountToApproveInWei = ethers.utils.parseEther("87");

                // transfer transaction 
                await tokenContract.connect(tokenOwner).approve(tokenSpender.address, amountToApproveInWei);
                const transaction = await tokenContract.connect(tokenSpender).transferFrom(tokenOwner.address, tokenReceiver.address, amountToApproveInWei);
                const receipt = await transaction.wait();

                // get transaction events
                const event = receipt.events.find(event => event.event === 'Transfer')
                const [
                    from,
                    to,
                    value
                ] = event.args;

                expect(from).to.equal(tokenOwner.address);
                expect(to).to.equal(tokenReceiver.address);
                expect(value).to.equal(amountToApproveInWei);
            });

            it('should allow to transfer all approved tokens on behalf of another user', async () => {
                const tokenOwner = ownerAccount;
                const tokenSpender = someOtherAccount1;
                const tokenReceiver = someOtherAccount2;
                const amountToApproveInWei = ethers.utils.parseEther("56");

                // balances before transaction
                const ownerBalanceBefore = await tokenContract.balanceOf(tokenOwner.address);
                const spenderBalanceBefore = await tokenContract.balanceOf(tokenSpender.address);
                const receiverBalanceBefore = await tokenContract.balanceOf(tokenReceiver.address);

                // "tokenOwner" approves "tokenSpender" to spend 56 from his account
                await tokenContract.connect(tokenOwner).approve(tokenSpender.address, amountToApproveInWei);

                // "tokenSpender" transfering 56 tokens from "tokenOwner" account to "tokenReceiver"
                await tokenContract.connect(tokenSpender).transferFrom(tokenOwner.address, tokenReceiver.address, amountToApproveInWei);

                // balances after transaction
                const ownerBalanceAfter = await tokenContract.balanceOf(tokenOwner.address);
                const spenderBalanceAfter = await tokenContract.balanceOf(tokenSpender.address);
                const receiverBalanceAfter = await tokenContract.balanceOf(tokenReceiver.address);

                expect(ownerBalanceAfter).to.equal(ownerBalanceBefore.sub(amountToApproveInWei));
                expect(receiverBalanceAfter).to.equal(receiverBalanceBefore.add(amountToApproveInWei));
                expect(spenderBalanceAfter).to.equal(spenderBalanceBefore);
            });

            it('should allow to transfer some approved tokens on behalf of another user and update remaining allowance', async () => {
                const tokenOwner = ownerAccount;
                const tokenSpender = someOtherAccount1;
                const tokenReceiver = someOtherAccount2;
                const amountToApproveInWei = ethers.utils.parseEther("147");
                const amountToSpendInWei = ethers.utils.parseEther("46");

                // balances before transaction
                const ownerBalanceBefore = await tokenContract.balanceOf(tokenOwner.address);
                const receiverBalanceBefore = await tokenContract.balanceOf(tokenReceiver.address);

                await tokenContract.connect(tokenOwner).approve(tokenSpender.address, amountToApproveInWei);

                // transfering 46 tokens from 147 approved
                await tokenContract.connect(tokenSpender).transferFrom(tokenOwner.address, tokenReceiver.address, amountToSpendInWei);

                // balances after transaction and remaining allowance
                const ownerBalanceAfter = await tokenContract.balanceOf(tokenOwner.address);
                const receiverBalanceAfter = await tokenContract.balanceOf(tokenReceiver.address);
                const remainingAllowance = await tokenContract.allowance(tokenOwner.address, tokenSpender.address);

                expect(ownerBalanceAfter).to.equal(ownerBalanceBefore.sub(amountToSpendInWei));
                expect(receiverBalanceAfter).to.equal(receiverBalanceBefore.add(amountToSpendInWei));
                expect(remainingAllowance).to.equal(amountToApproveInWei.sub(amountToSpendInWei))
            });

            it('should NOT allow to transfer more tokens than approved', async () => {
                const tokenOwner = ownerAccount;
                const tokenSpender = someOtherAccount1;
                const tokenReceiver = someOtherAccount2;
                const amountToApproveInWei = ethers.utils.parseEther("1");
                const amountToSpendInWei = ethers.utils.parseEther("3");

                // balances after transaction
                const ownerBalanceBefore = await tokenContract.balanceOf(tokenOwner.address);
                const receiverBalanceBefore = await tokenContract.balanceOf(tokenReceiver.address);

                await tokenContract.connect(tokenOwner).approve(tokenSpender.address, amountToApproveInWei);

                // trying to transfer more than approved
                const transaction = tokenContract.connect(tokenSpender).transferFrom(tokenOwner.address, tokenReceiver.address, amountToSpendInWei);

                // confirm transcation failed
                await expect(transaction).to.be.revertedWith("BEP20: insufficient allowance");

                // balances after transaction
                const ownerBalanceAfter = await tokenContract.balanceOf(tokenOwner.address);
                const receiverBalanceAfter = await tokenContract.balanceOf(tokenReceiver.address);

                // confirm balances remain unchanged
                expect(ownerBalanceAfter).to.equal(ownerBalanceBefore);
                expect(receiverBalanceAfter).to.equal(receiverBalanceBefore);
            });

            it('should allow to approve themselves', async () => {

                const tokenOwner = ownerAccount;
                const tokenSpender = ownerAccount;
                const amountToApproveInWei = ethers.utils.parseEther("2");

                await tokenContract.connect(tokenOwner).approve(tokenSpender.address, amountToApproveInWei);

                const approvedAmount = await tokenContract.allowance(tokenOwner.address, tokenSpender.address);
                expect(approvedAmount).to.equal(amountToApproveInWei)
            });

            it('should allow to increase allowance ', async () => {

                const tokenOwner = ownerAccount;
                const tokenSpender = someOtherAccount1;
                const amountToApproveInWei = ethers.utils.parseEther("945");
                const amountToIncreaseInWei = ethers.utils.parseEther("1");

                await tokenContract.connect(tokenOwner).approve(tokenSpender.address, amountToApproveInWei);

                await tokenContract.connect(tokenOwner).increaseAllowance(tokenSpender.address, amountToIncreaseInWei);

                const allowance = await tokenContract.allowance(tokenOwner.address, tokenSpender.address);
                expect(allowance).to.equal(amountToApproveInWei.add(amountToIncreaseInWei))
            });

            it('should emit an Approval event after increasing allowance ', async () => {

                const tokenOwner = ownerAccount;
                const tokenSpender = someOtherAccount1;
                const amountToApproveInWei = ethers.utils.parseEther("1");
                const amountToIncreaseInWei = ethers.utils.parseEther("3");

                await tokenContract.connect(tokenOwner).approve(tokenSpender.address, amountToApproveInWei);

                const transaction = await tokenContract.connect(tokenOwner).increaseAllowance(tokenSpender.address, amountToIncreaseInWei);
                const receipt = await transaction.wait();

                const event = receipt.events.find(event => event.event === 'Approval')
                const [
                    owner,
                    spender,
                    value
                ] = event.args;

                expect(owner).to.equal(tokenOwner.address);
                expect(spender).to.equal(tokenSpender.address);
                expect(value).to.equal(amountToApproveInWei.add(amountToIncreaseInWei));
            });

            it('should allow to decrease allowance ', async () => {

                const tokenOwner = ownerAccount;
                const tokenSpender = someOtherAccount1;
                const amountToApproveInWei = ethers.utils.parseEther("23");
                const amountToDecreaseInWei = ethers.utils.parseEther("13");

                await tokenContract.connect(tokenOwner).approve(tokenSpender.address, amountToApproveInWei);

                await tokenContract.connect(tokenOwner).decreaseAllowance(tokenSpender.address, amountToDecreaseInWei);

                const allowance = await tokenContract.allowance(tokenOwner.address, tokenSpender.address);
                expect(allowance).to.equal(amountToApproveInWei.sub(amountToDecreaseInWei))
            });

            it('should emit an Approval event after decreasing allowance ', async () => {

                const tokenOwner = ownerAccount;
                const tokenSpender = someOtherAccount1;
                const amountToApproveInWei = ethers.utils.parseEther("51");
                const amountToDecreaseInWei = ethers.utils.parseEther("36");

                await tokenContract.connect(tokenOwner).approve(tokenSpender.address, amountToApproveInWei);

                const transaction = await tokenContract.connect(tokenOwner).decreaseAllowance(tokenSpender.address, amountToDecreaseInWei);
                const receipt = await transaction.wait();

                const event = receipt.events.find(event => event.event === 'Approval')
                const [
                    owner,
                    spender,
                    value
                ] = event.args;

                expect(owner).to.equal(tokenOwner.address);
                expect(spender).to.equal(tokenSpender.address);
                expect(value).to.equal(amountToApproveInWei.sub(amountToDecreaseInWei));
            });

            it('should NOT allow to increase allowance by 0 tokens', async () => {
                const tokenOwner = ownerAccount;
                const tokenSpender = someOtherAccount1;

                // trying to increase allowance by 0 
                const transaction = tokenContract.connect(tokenOwner).increaseAllowance(tokenSpender.address, "0");

                // confirm transcation failed
                await expect(transaction).to.be.revertedWith("BEP20: invalid amount");

            });

            it('should NOT allow to decrease allowance by 0 tokens', async () => {
                const tokenOwner = ownerAccount;
                const tokenSpender = someOtherAccount1;

                // trying to increase allowance by 0 
                const transaction = tokenContract.connect(tokenOwner).decreaseAllowance(tokenSpender.address, "0");

                // confirm transcation failed
                await expect(transaction).to.be.revertedWith("BEP20: invalid amount");
            });
        })

        describe("Overflow", async () => {

            it('should not execute transactions that causes "uint256" overflow', async () => {
                const tokenOwner = ownerAccount;
                const tokenSpender = someOtherAccount1;

                const maxUint256Value = hre.ethers.BigNumber.from("0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff");

                // approving max uint256 amount of tokens
                await tokenContract.connect(tokenOwner).approve(tokenSpender.address, maxUint256Value);

                // try adding 1 more token
                await expect(
                    tokenContract.connect(tokenOwner).increaseAllowance(tokenSpender.address, 1)
                ).to.be.revertedWithPanic(PANIC_CODES.ARITHMETIC_UNDER_OR_OVERFLOW);
            });

        })
    })
})