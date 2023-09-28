const { expect } = require("chai")
const hre = require("hardhat")
const { time, mine, takeSnapshot  } = require("@nomicfoundation/hardhat-network-helpers");
const dayjs = require('dayjs')
var utc = require('dayjs/plugin/utc')
var duration = require('dayjs/plugin/duration')
dayjs.extend(utc)
dayjs.extend(duration)

describe("VestingWallet Tests", () => {

    let ownerAccount;
    let someOtherAccount1;
    let someOtherAccount2;
    let tokenContract;
    let walletContract;
    let tokenAddress;
    let walletAddress;
    let blockchainSnapshot;

    beforeEach(async () => {
        // get some accounts
        [
            ownerAccount,
            someOtherAccount1,
            someOtherAccount2
        ] = await hre.ethers.getSigners();

        blockchainSnapshot = await takeSnapshot();

        // deploy the token
        const tokenContractFactory = await hre.ethers.getContractFactory("BEP20Token");
        tokenContract = await tokenContractFactory.deploy();
        await tokenContract.deployed();
        tokenAddress = tokenContract.address;

        //deploy the fake westing wallet with time control ability
        const walletContractFactory = await hre.ethers.getContractFactory("VestingWallet");
        walletContract = await walletContractFactory.deploy(tokenAddress);
        await walletContract.deployed();
        walletAddress = walletContract.address;

        // transfer 1 000 001 tokens to the wallet
        await tokenContract.connect(ownerAccount).transfer(walletAddress, 1000001);
    });

    afterEach(async () => {
        await blockchainSnapshot.restore();
    });

    describe("After Deployment", async () => {

        it("token should be deployed successfully", async () => {
            expect(tokenContract.address).to.not.be.null;
        });

        it("vesting wallet should be deployed successfully", async () => {
            expect(walletContract.address).to.not.be.null;
        });

        it("vesting wallet should have the correct owner", async () => {
            const walletContractOwner = await walletContract.getOwner();

            expect(walletContractOwner).to.equal(ownerAccount.address);
        });

        it("token address and vesting wallet token address should match", async() => {
            const walletTokenAddress = await walletContract.getToken();
            
            expect(walletTokenAddress).to.equal(tokenAddress);
        })

        it("wallet should be able to receive tokens", async() => {
            const walletBalance = await tokenContract.balanceOf(walletAddress);
            expect(walletBalance).to.equal(1000001);
        })

        it("withdrawable amount should be equal to the token amount transfered", async() => {   
            const withdrawableAmountFromWallet = await walletContract.getWithdrawableAmount();
            expect(withdrawableAmountFromWallet).to.equal(1000001);
        })

    })

    describe("Vesting Schedule Creation => createVestingSchedule()", async() => {

        let defaultBeneficiaryAddress;
        let defaultStartTime;
        let defaultCliff;
        let defaultDuration;
        let defaultSlicePeriodSeconds;
        let defaultRevokable;
        let defaultAmount;

        beforeEach(async () => {

            defaultBeneficiaryAddress = someOtherAccount1.address;
            defaultStartTime = dayjs.utc().unix();;
            defaultCliff = 0;
            defaultDuration = dayjs.duration(1, 'days').asSeconds();
            defaultSlicePeriodSeconds = 1;
            defaultRevokable = true;
            defaultAmount = 100;
        });

        it("should allow the contract owner to create new valid vesting schedules", async() => {
            // act
            await walletContract.createVestingSchedule(
                defaultBeneficiaryAddress,
                defaultStartTime,
                defaultCliff,
                defaultDuration,
                defaultSlicePeriodSeconds,
                defaultRevokable,
                defaultAmount
            );

            // assert
            const totalVestingSchedulesCount = await walletContract.getVestingSchedulesCount();
            expect(totalVestingSchedulesCount).to.equal(1);

            const beneficiaryVestingScheduleCount = await walletContract.getVestingSchedulesCountByBeneficiary(defaultBeneficiaryAddress);  
            expect(beneficiaryVestingScheduleCount).to.equal(1);
        })

        it("should allow extract the underlying vesting object with correct properties", async() => {
            // act
            await walletContract.createVestingSchedule(
                defaultBeneficiaryAddress,
                defaultStartTime,
                defaultCliff,
                defaultDuration,
                defaultSlicePeriodSeconds,
                defaultRevokable,
                defaultAmount
            );
            const vestingScheduleId = await walletContract.computeVestingScheduleIdForAddressAndIndex(defaultBeneficiaryAddress, 0)
            const vestingScheduleObject = await walletContract.getVestingSchedule(vestingScheduleId);

            // assert
            expect(vestingScheduleObject).to.not.be.null;
            expect(vestingScheduleObject).to.not.be.undefined;
            expect(vestingScheduleObject.initialized).to.equal(true);
            expect(vestingScheduleObject.beneficiary).to.equal(defaultBeneficiaryAddress);
            expect(vestingScheduleObject.start).to.equal(defaultStartTime);
            expect(vestingScheduleObject.duration).to.equal(defaultDuration);
            expect(vestingScheduleObject.slicePeriod).to.equal(defaultSlicePeriodSeconds);
            expect(vestingScheduleObject.revocable).to.equal(true);
            expect(vestingScheduleObject.amountTotal).to.equal(defaultAmount);
            expect(vestingScheduleObject.released).to.equal(0);
            expect(vestingScheduleObject.revoked).to.equal(false);
        })

        it("should NOT allow to create schedules for more tokens that there are currently in the wallet", async() => {
            // act 
            const invalidAmount = 1000002;
            const transaction =  walletContract.createVestingSchedule(
                defaultBeneficiaryAddress,
                defaultStartTime,
                defaultCliff,
                defaultDuration,
                defaultSlicePeriodSeconds,
                defaultRevokable,
                invalidAmount
            );

            // assert
            await expect(transaction).to.be.revertedWith("VestingWallet: not enough tokens in the wallet");
        })

        it("should allow to create multiple schedules for the same beneficiary", async() => {
            // first schedule
            await walletContract.createVestingSchedule(
                defaultBeneficiaryAddress,
                defaultStartTime,
                defaultCliff,
                defaultDuration,
                defaultSlicePeriodSeconds,
                defaultRevokable,
                defaultAmount
            );
            
            // second schedule starts 1 second after the first one ends
            const secondScheduleStartTime = defaultStartTime + defaultDuration + 1;
            await walletContract.createVestingSchedule(
                defaultBeneficiaryAddress,
                secondScheduleStartTime,
                defaultCliff,
                defaultDuration,
                defaultSlicePeriodSeconds,
                defaultRevokable,
                defaultAmount
            );

            // assert
            const scheduleCount = await walletContract.getVestingSchedulesCountByBeneficiary(defaultBeneficiaryAddress)
            expect(scheduleCount).to.equal(2);
        })

        it("should NOT allow to create multiple schedules for more tokens that there are currently in the wallet", async() => {
            // first schedule runs ok
            const amount = 1000001;
            await walletContract.createVestingSchedule(
                defaultBeneficiaryAddress,
                defaultStartTime,
                defaultCliff,
                defaultDuration,
                defaultSlicePeriodSeconds,
                defaultRevokable,
                amount
            );

            // second should fail
            const transaction =  walletContract.createVestingSchedule(
                defaultBeneficiaryAddress,
                defaultStartTime + defaultDuration + 1,
                defaultCliff,
                defaultDuration,
                defaultSlicePeriodSeconds,
                defaultRevokable,
                1
            );

            // assert
            await expect(transaction).to.be.revertedWith("VestingWallet: not enough tokens in the wallet");
        })

        it("should allow ONLY the wallet owner to create new schedules", async() => {
            // act 
            const transaction =  walletContract.connect(someOtherAccount2).createVestingSchedule(
                defaultBeneficiaryAddress,
                defaultStartTime,
                defaultCliff,
                defaultDuration,
                defaultSlicePeriodSeconds,
                defaultRevokable,
                defaultAmount
            );

            // assert
            await expect(transaction).to.be.revertedWith("Ownable: caller is not the owner");
        })

        it("should NOT allow schedules with non-positive durations", async() => {
            // act
            const invalidDuration = 0;
            const transaction = walletContract.createVestingSchedule(
                defaultBeneficiaryAddress,
                defaultStartTime,
                defaultCliff,
                invalidDuration,
                defaultSlicePeriodSeconds,
                defaultRevokable,
                defaultAmount
            );

            // assert
            await expect(transaction).to.be.revertedWith("VestingWallet: invalid duration");
        })

        it("should NOT allow schedules with non-positive amounts", async() => {
            // act
            const invalidAmount = 0;
            const transaction = walletContract.createVestingSchedule(
                defaultBeneficiaryAddress,
                defaultStartTime,
                defaultCliff,
                defaultDuration,
                defaultSlicePeriodSeconds,
                defaultRevokable,
                invalidAmount
            );

            // assert
            await expect(transaction).to.be.revertedWith("VestingWallet: invalid amount");
        })

        it("should NOT allow schedules with invalid slices", async() => {
            // act
            const invalidSlice = 0;
            const transaction = walletContract.createVestingSchedule(
                defaultBeneficiaryAddress,
                defaultStartTime,
                defaultCliff,
                defaultDuration,
                invalidSlice,
                defaultRevokable,
                defaultAmount
            );

            // assert
            await expect(transaction).to.be.revertedWith("VestingWallet: invalid slice period");
        })

        it("should NOT allow schedules with duration beig less than the clif", async() => {
            // act
            const clif = 100;
            const duration = 99;
            const transaction = walletContract.createVestingSchedule(
                defaultBeneficiaryAddress,
                defaultStartTime,
                clif,
                duration,
                defaultSlicePeriodSeconds,
                defaultRevokable,
                defaultAmount
            );

            // assert
            await expect(transaction).to.be.revertedWith("VestingWallet: duration and clif incompatible");
        })

        it("should reduce the total withdrawable amount of the contract by the amount of a new vesting schedule", async() => {
            
            const withdrawableAmountBefore = await walletContract.getWithdrawableAmount();

            // act
            await walletContract.createVestingSchedule(
                defaultBeneficiaryAddress,
                defaultStartTime,
                defaultCliff,
                defaultDuration,
                defaultSlicePeriodSeconds,
                defaultRevokable,
                defaultAmount
            );

            // assert
            const withdrawableAmountAfter = await walletContract.getWithdrawableAmount();
            expect(withdrawableAmountAfter).to.equal(withdrawableAmountBefore - defaultAmount);
        })

        it("should have no releasable tokens just after schedule creation", async() => {
            // act
            await walletContract.createVestingSchedule(
                defaultBeneficiaryAddress,
                defaultStartTime,
                defaultCliff,
                defaultDuration,
                defaultSlicePeriodSeconds,
                defaultRevokable,
                defaultAmount
            );
            
            // assert
            const vestingScheduleId = await walletContract.computeVestingScheduleIdForAddressAndIndex(defaultBeneficiaryAddress, 0)
            const currentReleasableTokenAmount = await walletContract.computeReleasableAmount(vestingScheduleId);
            expect(currentReleasableTokenAmount).to.equal(0);
        })
    })

    describe("One Beneficiary One Vesting Schedule", async() => {

        let defaultBaseTime;
        let defaultBeneficiaryAddress;
        let defaultStartTime;
        let defaultCliff;
        let defaultDuration;
        let defaultSlicePeriodSeconds;
        let defaultRevokable;
        let defaultAmount;
        let vestingScheduleId;

        beforeEach(async () => {

            defaultBaseTime = dayjs.utc();
            defaultBeneficiaryAddress = someOtherAccount1.address;
            // starts in 5 days from now
            defaultStartTime = defaultBaseTime.add(5, "day") 
            defaultCliff = 0
            // all tokens will be released 13 days from the start (or 18 days from now) 
            defaultDuration = dayjs.duration(13, 'days').asSeconds() 
            defaultSlicePeriodSeconds = 60;
            defaultRevokable = false
            defaultAmount = 1000000;

            await walletContract.createVestingSchedule(
                defaultBeneficiaryAddress,
                defaultStartTime.unix(),
                defaultCliff,
                defaultDuration,
                defaultSlicePeriodSeconds,
                defaultRevokable,
                defaultAmount
            );

            vestingScheduleId = await walletContract.computeVestingScheduleIdForAddressAndIndex(defaultBeneficiaryAddress, 0);
        });

        it("beneficiary should have only one schedule", async() => {
            const scheduleCount = await walletContract.getVestingSchedulesCountByBeneficiary(defaultBeneficiaryAddress)
            expect(scheduleCount).to.equal(1);
        })

        it("there should be no releasable tokens just after creation", async() => {
            const currentReleasableTokenAmount = await walletContract.computeReleasableAmount(vestingScheduleId);
            expect(currentReleasableTokenAmount).to.equal(0);
        })

        it("there should be NO releasable tokens before vesting start", async() => {
            // wait 5 days - 1 second (i.e. 1 second before vesting starts)
            await time.increase((5 * 24 * 60 * 60) - 1);

            const currentReleasableTokenAmount = await walletContract.computeReleasableAmount(vestingScheduleId);
            expect(currentReleasableTokenAmount).to.equal(0);
        })

        it("there should be SOME releasable tokens after vesting start", async() => {
            // wait 5 days + 5 minutes (i.e. 5 minutes after vesting starts)
            await time.increase((5 * 24 * 60 * 60) + 5 * 60);

            const currentReleasableTokenAmount = await walletContract.computeReleasableAmount(vestingScheduleId);
            expect(currentReleasableTokenAmount.toNumber()).to.be.above(0)
        })

        it("half the tokens should be releasable after half vesting period has passed", async() => {
            // simulate half of of the vesting period
            const halfWay = defaultStartTime.unix() + defaultDuration/2;
            await time.increaseTo(halfWay);

            const currentReleasableTokenAmount = await walletContract.computeReleasableAmount(vestingScheduleId);
            expect(currentReleasableTokenAmount.toNumber()).to.equal(500000)
        })

        it("all tokens should be releasable after vesting ends", async() => {
            // set the contract time to 1 second after vesting ends
            const oneSecondAfterVestingEnd = defaultStartTime.unix() + defaultDuration + 1;
            await time.increase(oneSecondAfterVestingEnd);

            const currentReleasableTokenAmount = await walletContract.computeReleasableAmount(vestingScheduleId);
            expect(currentReleasableTokenAmount.toNumber()).to.equal(defaultAmount)
        })

        it("after release tokens sould be moved from the wallet to the beneficiary", async() => {
            // get balances before
            const beneficiaryTokenBalanceBefore = await tokenContract.balanceOf(defaultBeneficiaryAddress);
            const walletTokenBalanceBefore = await tokenContract.balanceOf(walletAddress);

            // set the contract time to 1 second after vesting ends
            const oneSecondAfterVestingEnd = defaultStartTime.unix() + defaultDuration + 1;
            await time.increase(oneSecondAfterVestingEnd);

            // release tokens
            await walletContract.release(vestingScheduleId, defaultAmount);

            // get balances before
            const beneficiaryTokenBalanceAfter = await tokenContract.balanceOf(defaultBeneficiaryAddress);
            const walletTokenBalanceAfter = await tokenContract.balanceOf(walletAddress);

            // assert
            expect(beneficiaryTokenBalanceBefore.toNumber()).to.equal(0)
            expect(walletTokenBalanceBefore.toNumber()).to.equal(1000001)
            expect(beneficiaryTokenBalanceAfter.toNumber()).to.equal(defaultAmount)
            expect(walletTokenBalanceAfter.toNumber()).to.equal(1)
        })

        it("beneficiary should be able to release tokens", async() => {
            // set the contract time to 1 second after vesting ends
            const oneSecondAfterVestingEnd = defaultStartTime.unix() + defaultDuration + 1;
            await time.increase(oneSecondAfterVestingEnd);

            // connect as beneficiary
            await walletContract.connect(someOtherAccount1).release(vestingScheduleId, defaultAmount);

            // get balances before
            const beneficiaryTokenBalanceAfter = await tokenContract.balanceOf(defaultBeneficiaryAddress);

            // assert
            expect(beneficiaryTokenBalanceAfter.toNumber()).to.equal(defaultAmount)
        })

        it("wallet owner should be able to release tokens", async() => {
            // set the contract time to 1 second after vesting ends
            const oneSecondAfterVestingEnd = defaultStartTime.unix() + defaultDuration + 1;
            await time.increase(oneSecondAfterVestingEnd);

            // connect as beneficiary
            await walletContract.connect(ownerAccount).release(vestingScheduleId, defaultAmount);

            // get balances before
            const beneficiaryTokenBalanceAfter = await tokenContract.balanceOf(defaultBeneficiaryAddress);

            // assert
            expect(beneficiaryTokenBalanceAfter.toNumber()).to.equal(defaultAmount)
        })

        it("other accounts should NOT be able to release tokens", async() => {
            // set the contract time to 1 second after vesting ends
            const oneSecondAfterVestingEnd = defaultStartTime.unix() + defaultDuration + 1;
            await time.increase(oneSecondAfterVestingEnd);

            // connect as beneficiary
            const transaction =  walletContract.connect(someOtherAccount2).release(vestingScheduleId, defaultAmount);

            await expect(transaction).to.be.revertedWith("VestingWallet: only beneficiary or owner can release vested tokens");
        })

        it("it should NOT be possible to relase more tokens than vested amount", async() => {
            // set the contract time to 1 second after vesting ends
            const oneSecondAfterVestingEnd = defaultStartTime.unix() + defaultDuration + 1;
            await time.increase(oneSecondAfterVestingEnd);

            const transaction =  walletContract.release(vestingScheduleId, defaultAmount + 1);

            await expect(transaction).to.be.revertedWith("VestingWallet: cannot release tokens, not enough vested tokens");
        })

        it("it should be allowed to release only part of the vested tokens", async() => {
            // set the contract time to 1 second after vesting ends
            const oneSecondAfterVestingEnd = defaultStartTime.unix() + defaultDuration + 1;
            await time.increase(oneSecondAfterVestingEnd);
            await walletContract.release(vestingScheduleId, 200000);

            //balances after first release
            const beneficiaryTokenBalance1 = await tokenContract.balanceOf(defaultBeneficiaryAddress);
            const walletTokenBalance1 = await tokenContract.balanceOf(walletAddress);

            expect(beneficiaryTokenBalance1.toNumber()).to.equal(200000)
            expect(walletTokenBalance1.toNumber()).to.equal(1000001 - 200000)


            await walletContract.release(vestingScheduleId, 400000);

            //balances after second release
            const beneficiaryTokenBalance2 = await tokenContract.balanceOf(defaultBeneficiaryAddress);
            const walletTokenBalance2 = await tokenContract.balanceOf(walletAddress);
          
            // assert
            expect(beneficiaryTokenBalance2.toNumber()).to.equal(200000 + 400000)
            expect(walletTokenBalance2.toNumber()).to.equal(1000001 - 200000 - 400000)
        })

        it("it should NOT be possible to release more tokens thans there's left after batch", async() => {
            // set the contract time to 1 second after vesting ends
            const oneSecondAfterVestingEnd = defaultStartTime.unix() + defaultDuration + 1;
            await time.increase(oneSecondAfterVestingEnd);

            // first release
            await walletContract.release(vestingScheduleId, 900000);

            // second release
            const transaction = walletContract.release(vestingScheduleId, 100001);

            await expect(transaction).to.be.revertedWith("VestingWallet: cannot release tokens, not enough vested tokens");

            //balances after second atempt 
            const beneficiaryTokenBalance2 = await tokenContract.balanceOf(defaultBeneficiaryAddress);
            const walletTokenBalance2 = await tokenContract.balanceOf(walletAddress);
          
            // assert (only the first relase happened)
            expect(beneficiaryTokenBalance2.toNumber()).to.equal(900000)
            expect(walletTokenBalance2.toNumber()).to.equal(1000001 - 900000)
        })

        it("after token release the Vesting Schedules Total Amount should be updated", async() => {
            // set the contract time to 1 second after vesting ends
            const oneSecondAfterVestingEnd = defaultStartTime.unix() + defaultDuration + 1;
            await time.increase(oneSecondAfterVestingEnd);

            // release tokens
            await walletContract.release(vestingScheduleId, 300000);

            const totalAmount = await walletContract.getVestingSchedulesTotalAmount();

            // assert
            expect(totalAmount.toNumber()).to.equal(1000000 - 300000)
        })
    })

    describe("One Beneficiary Multiple Vesting Schedules", async() => {

        let beneficiaryAddress;
            
        let firstScheduleStartTime;
        let firstScheduleDuration;
        let firstScheduleAmount;
        let firstVestingScheduleId; 

        let secondScheduleStartTime;
        let secondScheduleDuration;
        let secondScheduleAmount;
        let secondVestingScheduleId; 
       
        beforeEach(async () => {

            const slicePeriod = 60;
            const revokable = false;
            const clif = 0;
            const baseTime = dayjs.utc();
            beneficiaryAddress = someOtherAccount1.address;

            // first schedule
            //    starts in 1 second
            //    duration is 2 second
            //    vested amount is 200 000    

            firstScheduleStartTime = baseTime.add(1, "second");
            firstScheduleDuration = 2;
            firstScheduleAmount = 200000;

            await walletContract.createVestingSchedule(
                beneficiaryAddress,
                firstScheduleStartTime.unix(),
                clif,
                firstScheduleDuration,
                slicePeriod,
                revokable,
                firstScheduleAmount
            );

            firstVestingScheduleId = await walletContract.computeVestingScheduleIdForAddressAndIndex(beneficiaryAddress, 0);

            // seconds schedule
            //    start 1 second after the first schedule ends
            //    duration is 10 days
            //    vested amount is 450 000
            
            secondScheduleStartTime = firstScheduleStartTime.unix() + firstScheduleDuration + 1;
            secondScheduleDuration = dayjs.duration(10, 'days').asSeconds();
            secondScheduleAmount = 450000;

            await walletContract.createVestingSchedule(
                beneficiaryAddress,
                secondScheduleStartTime,
                clif,
                secondScheduleDuration,
                slicePeriod,
                revokable,
                secondScheduleAmount
            );

            secondVestingScheduleId = await walletContract.computeVestingScheduleIdForAddressAndIndex(beneficiaryAddress, 1);
        });

        it("beneficiary should have 2 schedules", async() => {
            const scheduleCount = await walletContract.getVestingSchedulesCountByBeneficiary(beneficiaryAddress)
            expect(scheduleCount).to.equal(2);
        })

        it("total schedule count shoud be 2", async() => {
            const totalVestingSchedulesCount = await walletContract.getVestingSchedulesCount();
            expect(totalVestingSchedulesCount).to.equal(2);
        })

        it("total vested amout should be the sum off all schedules", async() => {
            const amount = await walletContract.getVestingSchedulesTotalAmount()
            expect(amount).to.equal(firstScheduleAmount + secondScheduleAmount);
        })

        describe("after the first schedule ends", async() => {

            beforeEach(async () => {
                // set the contract time to 1 second after the first schedule ends
                const oneSecondAfterFirstScheduleEnd = firstScheduleStartTime.unix() + firstScheduleDuration + 1;
                await time.setNextBlockTimestamp(oneSecondAfterFirstScheduleEnd);
                await mine();
            });

            it("all tokens from the first schedule should be releasable", async() => {
                const releasableTokenAmount = await walletContract.computeReleasableAmount(firstVestingScheduleId);
                expect(releasableTokenAmount.toNumber()).to.equal(firstScheduleAmount)
            })

            it("balances should be updated properly after token release", async() => {
                // get balances before
                const beneficiaryTokenBalanceBefore = await tokenContract.balanceOf(beneficiaryAddress);
                const walletTokenBalanceBefore = await tokenContract.balanceOf(walletAddress);
    
                // release tokens
                await walletContract.release(firstVestingScheduleId, firstScheduleAmount);
    
                // get balances before
                const beneficiaryTokenBalanceAfter = await tokenContract.balanceOf(beneficiaryAddress);
                const walletTokenBalanceAfter = await tokenContract.balanceOf(walletAddress);
                const totalVestingAmountAfter = await walletContract.getVestingSchedulesTotalAmount();
    
                // assert
                expect(beneficiaryTokenBalanceBefore.toNumber()).to.equal(0)
                expect(walletTokenBalanceBefore.toNumber()).to.equal(1000001)
                expect(beneficiaryTokenBalanceAfter.toNumber()).to.equal(firstScheduleAmount)
                expect(walletTokenBalanceAfter.toNumber()).to.equal(1000001 - firstScheduleAmount)
                expect(totalVestingAmountAfter.toNumber()).to.equal(650000 - firstScheduleAmount)
            })

            it("trying to release more tokens than there was locked should fail", async() => {
                const transaction = walletContract.release(firstVestingScheduleId, firstScheduleAmount + 1);
                await expect(transaction).to.be.revertedWith("VestingWallet: cannot release tokens, not enough vested tokens");
            })

            it("trying to release tokens from other schedules that have not finished yet should fail", async() => {
                const transaction = walletContract.release(secondVestingScheduleId, 10);
                await expect(transaction).to.be.revertedWith("VestingWallet: cannot release tokens, not enough vested tokens");
            })
        })

        describe("after the second schedule ends", async() => {
            
            beforeEach(async () => {
                // set the contract time to 1 second after the second schedule ends
                const oneSecondAfterSecondScheduleEnd = secondScheduleStartTime + secondScheduleDuration + 1;
                await time.setNextBlockTimestamp(oneSecondAfterSecondScheduleEnd);
                await mine();
            }); 

            it("all tokens from the second schedule should be releasable", async() => {
                const releasableTokenAmount = await walletContract.computeReleasableAmount(secondVestingScheduleId);
                expect(releasableTokenAmount.toNumber()).to.equal(secondScheduleAmount)
            })

            it("all tokens from the first schedule should also be releasable (because the first schedule also ended)", async() => {
                const releasableTokenAmount = await walletContract.computeReleasableAmount(firstVestingScheduleId);
                expect(releasableTokenAmount.toNumber()).to.equal(firstScheduleAmount)
            })

            it("tokens from first and second schedules should be released", async() => {
                // get balances before
                const beneficiaryTokenBalanceBefore = await tokenContract.balanceOf(beneficiaryAddress);
                const walletTokenBalanceBefore = await tokenContract.balanceOf(walletAddress);
    
                // release all tokens from the first schedule
                await walletContract.release(firstVestingScheduleId, firstScheduleAmount);

                // release all tokens from the second schedule
                await walletContract.release(secondVestingScheduleId, secondScheduleAmount);
    
                // get balances before
                const beneficiaryTokenBalanceAfter = await tokenContract.balanceOf(beneficiaryAddress);
                const walletTokenBalanceAfter = await tokenContract.balanceOf(walletAddress);
                const totalVestingAmountAfter = await walletContract.getVestingSchedulesTotalAmount();
    
                // assert
                expect(beneficiaryTokenBalanceBefore.toNumber()).to.equal(0)
                expect(walletTokenBalanceBefore.toNumber()).to.equal(1000001)
                expect(beneficiaryTokenBalanceAfter.toNumber()).to.equal(firstScheduleAmount + secondScheduleAmount)
                expect(walletTokenBalanceAfter.toNumber()).to.equal(1000001 - firstScheduleAmount - secondScheduleAmount)
                expect(totalVestingAmountAfter.toNumber()).to.equal(0)
            })

            it("tokens from first and second schedules should be released in one transaction/method", async() => {
                // get balances before
                const beneficiaryTokenBalanceBefore = await tokenContract.balanceOf(beneficiaryAddress);
                const walletTokenBalanceBefore = await tokenContract.balanceOf(walletAddress);

                // create the arrays required to release both schedules at once
                const scheduleIds = [firstVestingScheduleId, secondVestingScheduleId];
                const amounts = [firstScheduleAmount, secondScheduleAmount];

                // release amounts from both schedules in one call/transaction
                await walletContract.releaseMultiple(scheduleIds, amounts);
        
                // get balances after
                const beneficiaryTokenBalanceAfter = await tokenContract.balanceOf(beneficiaryAddress);
                const walletTokenBalanceAfter = await tokenContract.balanceOf(walletAddress);
                const totalVestingAmountAfter = await walletContract.getVestingSchedulesTotalAmount();
    
                // assert
                expect(beneficiaryTokenBalanceBefore.toNumber()).to.equal(0)
                expect(walletTokenBalanceBefore.toNumber()).to.equal(1000001)
                expect(beneficiaryTokenBalanceAfter.toNumber()).to.equal(firstScheduleAmount + secondScheduleAmount)
                expect(walletTokenBalanceAfter.toNumber()).to.equal(1000001 - firstScheduleAmount - secondScheduleAmount)
                expect(totalVestingAmountAfter.toNumber()).to.equal(0)
            })
        })
    })  
    
    describe("Multiple Beneficiaries One Vesting Schedule", async() => {

        let firstBeneficiaryAddress;
        let firstBeneficiaryScheduleId;
        let secondBeneficiaryAddress;
        let secondBeneficiaryScheduleId

        let startTime;
        let duration;
        let amount;

        beforeEach(async () => {
            firstBeneficiaryAddress = someOtherAccount1.address;
            secondBeneficiaryAddress = someOtherAccount2.address;
            startTime = dayjs.utc().add(1, "day")
            duration = dayjs.duration(3, 'days').asSeconds() 
            amount = 333000;
            const cliff = 0;
            const revocable = false;
            const slicePeriod = 60;

            // first schedule
            await walletContract.createVestingSchedule(
                firstBeneficiaryAddress,
                startTime.unix(),
                cliff,
                duration,
                slicePeriod,
                revocable,
                amount
            );

            firstBeneficiaryScheduleId = await walletContract.computeVestingScheduleIdForAddressAndIndex(firstBeneficiaryAddress, 0);

            // exactly the same schedule but a different beneficiary
            await walletContract.createVestingSchedule(
                secondBeneficiaryAddress,
                startTime.unix(),
                cliff,
                duration,
                slicePeriod,
                revocable,
                amount
            );

            secondBeneficiaryScheduleId = await walletContract.computeVestingScheduleIdForAddressAndIndex(secondBeneficiaryAddress, 0);
        });

        it("first beneficiary should have only one schedule", async() => {
            const scheduleCount = await walletContract.getVestingSchedulesCountByBeneficiary(firstBeneficiaryAddress)
            expect(scheduleCount).to.equal(1);
        })

        it("second beneficiary should have only one schedule", async() => {
            const scheduleCount = await walletContract.getVestingSchedulesCountByBeneficiary(secondBeneficiaryAddress)
            expect(scheduleCount).to.equal(1);
        })

        it("total schedule count shoud be 2", async() => {
            const totalVestingSchedulesCount = await walletContract.getVestingSchedulesCount();
            expect(totalVestingSchedulesCount).to.equal(2);
        })

        describe("before the schedule ends", async() => {
            
            beforeEach(async () => {
                // set the contract time to 1 hour before schedule
                const oneHourBeforeEnd = startTime.unix() + duration - (1 * 60 * 60);
                await time.setNextBlockTimestamp(oneHourBeforeEnd);
                await mine();
            }); 

            it("some tokens should be releasable for first beneficiary", async() => {
                const releasableTokenAmount = await walletContract.computeReleasableAmount(firstBeneficiaryScheduleId);
                expect(releasableTokenAmount.toNumber()).to.be.above(0);
                expect(releasableTokenAmount.toNumber()).to.be.below(amount);
            })

            it("some tokens should be releasable for second beneficiary", async() => {
                const releasableTokenAmount = await walletContract.computeReleasableAmount(secondBeneficiaryScheduleId);
                expect(releasableTokenAmount.toNumber()).to.be.above(0);
                expect(releasableTokenAmount.toNumber()).to.be.below(amount);
            })

            it("both beneficiaries should be allowed to relase vested tokens", async() => {
                // first beneficiary
                const firstBeneficiaryReleasableTokenAmount = await walletContract.computeReleasableAmount(firstBeneficiaryScheduleId);
                await walletContract.connect(someOtherAccount1).release(firstBeneficiaryScheduleId, firstBeneficiaryReleasableTokenAmount);
                const firstBeneficiaryBalance = await tokenContract.balanceOf(firstBeneficiaryAddress);
                expect(firstBeneficiaryBalance).to.equal(firstBeneficiaryReleasableTokenAmount);

                // second beneficiary
                const secondBeneficiaryReleasableTokenAmount = await walletContract.computeReleasableAmount(secondBeneficiaryScheduleId);
                await walletContract.connect(someOtherAccount2).release(secondBeneficiaryScheduleId, secondBeneficiaryReleasableTokenAmount);
                const secondBeneficiaryBalance = await tokenContract.balanceOf(firstBeneficiaryAddress);
                expect(secondBeneficiaryBalance).to.equal(secondBeneficiaryReleasableTokenAmount);

                // wallet balance
                const walletBalance = await tokenContract.balanceOf(walletAddress);
                expect(walletBalance).to.equal(1000001 - firstBeneficiaryReleasableTokenAmount - secondBeneficiaryReleasableTokenAmount);
            })

            it("either beneficiary trying to release all the tokens shoul fail", async() => {
                const firstBeneficiaryTransaction =  walletContract.connect(someOtherAccount1).release(firstBeneficiaryScheduleId, amount);
                const secondBeneficiaryTransaction =  walletContract.connect(someOtherAccount2).release(secondBeneficiaryScheduleId, amount);

                await expect(firstBeneficiaryTransaction).to.be.revertedWith("VestingWallet: cannot release tokens, not enough vested tokens");
                await expect(secondBeneficiaryTransaction).to.be.revertedWith("VestingWallet: cannot release tokens, not enough vested tokens");
            })
        })

        describe("after the schedule", async() => {
            
            beforeEach(async () => {
                // set the contract time to 1 hour after schedule
                const oneHourAfterEnd = startTime.unix() + duration + (1 * 60 * 60);
                await time.setNextBlockTimestamp(oneHourAfterEnd);
                await mine();
            }); 

            it("first beneficiary should be allowed to relase all tokens", async() => {
                await walletContract.connect(someOtherAccount1).release(firstBeneficiaryScheduleId, amount);
                const balance = await tokenContract.balanceOf(firstBeneficiaryAddress);
                expect(balance).to.equal(amount);
            })

            it("second beneficiary should be allowed to relase all tokens", async() => {
                await walletContract.connect(someOtherAccount2).release(secondBeneficiaryScheduleId, amount);
                const balance = await tokenContract.balanceOf(secondBeneficiaryAddress);
                expect(balance).to.equal(amount);
            })
        })
    })
})