const { expect } = require("chai")
const hre = require("hardhat")
const { time, takeSnapshot  } = require("@nomicfoundation/hardhat-network-helpers");

describe("StakingRewards Tests", () => {

    let owner;
    let account1;
    let account2;
    let account3;
	let rewardTokenContract;
	let stakingTokenContract;
	let externalTestTokenContract;
	let contract;
	let blockchainSnapshot;

	const REWARD_DURATION_IN_DAYS = 10;

	beforeEach(async () => {
        // get some accounts
        [
            owner,
            account1,
            account2,
            account3
        ] = await hre.ethers.getSigners();

		blockchainSnapshot = await takeSnapshot();

        // deploy main/reward token
        const rewardTokenContractFactory = await hre.ethers.getContractFactory("BEP20Token");
        rewardTokenContract = await rewardTokenContractFactory.deploy();
        await rewardTokenContract.deployed();

		// deploy staking token
		const stakingTokenContractFactory = await hre.ethers.getContractFactory("FakeLPToken");
		stakingTokenContract = await stakingTokenContractFactory.deploy();
		await stakingTokenContract.deployed();

        // deploy statking rewards contract
        const stakingRewardsContractFactory = await hre.ethers.getContractFactory("StakingRewards");
        contract = await stakingRewardsContractFactory.deploy(
			rewardTokenContract.address,
			stakingTokenContract.address,
			REWARD_DURATION_IN_DAYS
        );
        await contract.deployed();
    });

	afterEach(async () => {
        await blockchainSnapshot.restore();
    });

	describe("After Deployment", async () => {
		it("all contract should be deployed successfully", async () => {
			expect(rewardTokenContract.address).to.not.be.null;
			expect(stakingTokenContract.address).to.not.be.null;
			expect(contract.address).to.not.be.null;
        });

		it("reward token should be set correctly", async () => {
			expect(await contract._rewardsToken()).to.be.equal(rewardTokenContract.address);
        });

		it("staking token should be set correctly", async () => {
			expect(await contract._stakingToken()).to.be.equal(stakingTokenContract.address);
        });

		it("owner should be set correctly", async () => {
			expect(await contract.owner()).to.be.equal(owner.address);
        });

		it("should not be paused", async () => {
			expect(await contract.paused()).to.be.equal(false);
        });

		it("reward duration should be set correctly", async () => {
			expect(await contract._rewardsDuration()).to.be.equal(REWARD_DURATION_IN_DAYS * 24 * 60 * 60);
        });
	})

	describe("General Permissions", () => {
		it("only owner can call notifyRewardAmount", async () => {
			const tx = contract.connect(account1).notifyRewardAmount(1000);
            await expect(tx).to.be.revertedWith("Ownable: caller is not the owner");
		});

		it("only owner address can call setRewardsDuration", async () => {
			const tx = contract.connect(account1).setRewardsDuration(30);
            await expect(tx).to.be.revertedWith("Ownable: caller is not the owner");
		});

		it("only owner address can call setPaused", async () => {
			const tx = contract.connect(account1).setPaused(true);
            await expect(tx).to.be.revertedWith("Ownable: caller is not the owner");
		});
	})

	describe("Paused Contract => setPaused()", () => {

		beforeEach(async () => {
			await contract.connect(owner).setPaused(true);
		});

		it("should NOT accept new stakes", async () => {
			const tx = contract.connect(account1).stake(1000);
            await expect(tx).to.be.revertedWith("Pausable: this action cannot be performed while the contract is paused");
		});
	})

	describe("Token Recovery => recover()", () => {

		beforeEach(async () => {
			// deploy external test token
			const externalTestTokenContractFactory = await hre.ethers.getContractFactory("ExternalTestToken");
			externalTestTokenContract = await externalTestTokenContractFactory.deploy();
			await externalTestTokenContract.deployed();

			// send 1 000 000 external tokens to the staking rewards contract
			const amount = hre.ethers.BigNumber.from("1000000")
			await externalTestTokenContract.connect(owner).transfer(contract.address, amount);

			expect(await externalTestTokenContract.balanceOf(contract.address)).to.be.equal(amount);
		});

		it("only owner can recover tokens", async () => {
			const tx = contract.connect(account1).recover(externalTestTokenContract.address, 1 * 1000 *1000);
            await expect(tx).to.be.revertedWith("Ownable: caller is not the owner");
		});

		it("should NOT allow to recover staking tokens", async () => {
			const tx = contract.connect(owner).recover(stakingTokenContract.address, 1 * 1000 *1000);
            await expect(tx).to.be.revertedWith("StakingRewards: cannot withdraw the staking token");
		});

		it("should recover tokens and correctly update contract and recipient balances", async () => {
			const contractBalanceBefore = await externalTestTokenContract.balanceOf(contract.address);
			const ownerBalanceBefore = await externalTestTokenContract.balanceOf(owner.address);
			const amountToRevover = hre.ethers.BigNumber.from("1000000")

			await contract.connect(owner).recover(externalTestTokenContract.address, amountToRevover);

			const contractBalanceAfter = await externalTestTokenContract.balanceOf(contract.address);
			const ownerBalanceAfter = await externalTestTokenContract.balanceOf(owner.address);

            expect(contractBalanceAfter).to.be.equal(contractBalanceBefore.sub(amountToRevover));
			expect(ownerBalanceAfter).to.be.equal(ownerBalanceBefore.add(amountToRevover));
		});

		it("should emit Recovered event with correct args", async () => {
			const tx = await contract.connect(owner).recover(externalTestTokenContract.address, 1 * 1000 *1000);
            const receipt = await tx.wait();

            const event = receipt.events.find(event => event.event === 'Recovered')
            const [
                token,
                amount
            ] = event.args;
            expect(token).to.equal(externalTestTokenContract.address);
            expect(amount).to.equal("1000000");
		});
	})

	describe("Reward End Time => lastTimeRewardApplicable()", async () => {

		it("should be 0 initially", async () => {
            expect(await contract.lastTimeRewardApplicable()).to.equal("0");
		});

		describe("after updating the reward amount", async () => {
			it("should return the latest block timestamp", async () => {
				await contract.connect(owner).notifyRewardAmount(1000);

				const latestBlock = await hre.ethers.provider.getBlock("latest")
				const end = await contract.lastTimeRewardApplicable();

				expect(end).to.equal(latestBlock.timestamp);
			});
		})
	})

	describe("Rewards Per Staked Token => rewardPerToken()", async () => {

		it("should be 0 initially", async () => {
            expect(await contract.rewardPerToken()).to.equal("0");
		});

		describe("after staking some tokens", async () => {

			it("should be possitive", async () => {

				// transfer some tokens
				const amounToStake = hre.ethers.utils.parseEther("1000");
				const rewardAmount = hre.ethers.utils.parseEther("10000");
				await stakingTokenContract.connect(owner).transfer(account1.address, amounToStake);
				await stakingTokenContract.connect(account1).approve(contract.address, hre.ethers.constants.MaxUint256)
				await rewardTokenContract.connect(owner).transfer(contract.address, rewardAmount);
				await contract.connect(owner).notifyRewardAmount(rewardAmount);

				// stake
				await contract.connect(account1).stake(amounToStake);
				expect(await contract.totalSupply()).to.equal(amounToStake);

				// 'wait' 1 minute
				await time.increase(60);

				const rewardPerToken = await contract.rewardPerToken();
				expect(rewardPerToken).to.be.above(0)
			});

		})
	})

	describe("Staking => stake()", async () => {

		beforeEach(async () => {
			const amounToStake = hre.ethers.utils.parseEther("1");
			await stakingTokenContract.connect(owner).transfer(account1.address, amounToStake);
			await stakingTokenContract.connect(account1).approve(contract.address, hre.ethers.constants.MaxUint256);
		});

		it("should NOT allow to stake 0", async () => {
			const tx = contract.connect(owner).stake(0);
            await expect(tx).to.be.revertedWith("StakingRewards: cannot stake 0");
		})

		it("should set balances correctly", async () => {
			const amounToStake = hre.ethers.utils.parseEther("1");
			const contractBalanceBefore = await stakingTokenContract.balanceOf(contract.address);
			const accountBalanceBefore = await stakingTokenContract.balanceOf(account1.address);
			const accountBalanceInContractBefore = await contract.balanceOf(account1.address);
			
			await contract.connect(account1).stake(amounToStake);

			const contractBalanceAfter = await stakingTokenContract.balanceOf(contract.address);
			const accountBalanceAfter = await stakingTokenContract.balanceOf(account1.address);
			const accountBalanceInContractAfter = await contract.balanceOf(account1.address);
			const totalSupply = await contract.totalSupply();

			expect(contractBalanceBefore).to.be.equal(0);
			expect(accountBalanceInContractBefore).to.be.equal(0);
			expect(contractBalanceAfter).to.be.equal(contractBalanceBefore.add(amounToStake));
			expect(accountBalanceAfter).to.be.equal(accountBalanceBefore.sub(amounToStake));
			expect(accountBalanceInContractAfter).to.be.equal(accountBalanceInContractBefore.add(amounToStake));
			expect(accountBalanceInContractAfter).to.be.equal(amounToStake);
			expect(totalSupply).to.be.equal(amounToStake);
		})

		it("should emit the Staked event with correct args", async () => {
			const amountToStake = hre.ethers.utils.parseEther("1");
			const tx = await contract.connect(account1).stake(amountToStake);
            const receipt = await tx.wait();

            const event = receipt.events.find(event => event.event === 'Staked')
            const [
                user,
                amount
            ] = event.args;
            expect(user).to.equal(account1.address);
            expect(amount).to.equal(amountToStake);
		})
	})

	describe("Earned Rewards => earned()", async () => {

		it("should be 0 initially", async () => {
            expect(await contract.earned(account1.address)).to.equal("0");
		});

		it("should become positive after staking", async () => {

			const amountToStake = hre.ethers.utils.parseEther("100");
			await stakingTokenContract.connect(owner).transfer(account1.address, amountToStake);
			await stakingTokenContract.connect(account1).approve(contract.address, hre.ethers.constants.MaxUint256);
			await contract.connect(account1).stake(amountToStake);

			const rewardAmount = hre.ethers.utils.parseEther("500");
			await rewardTokenContract.connect(owner).transfer(contract.address, rewardAmount);
			await contract.notifyRewardAmount(rewardAmount);

			// 'wait' 1 hour
			await time.increase(60 * 60);

			const earned = await contract.earned(account1.address);
            expect(earned).to.be.above(0);
		});

		it('reward rate should increase if new rewards are added before DURATION ends', async () => {
			const firstRewardAmount = hre.ethers.utils.parseEther("100");
			await rewardTokenContract.connect(owner).transfer(contract.address, firstRewardAmount);
			await contract.notifyRewardAmount(firstRewardAmount);
			const firstRewardRate = await contract._rewardRate();

			const secondRewardAmount = hre.ethers.utils.parseEther("200");
			await rewardTokenContract.connect(owner).transfer(contract.address, secondRewardAmount);
			await contract.notifyRewardAmount(secondRewardAmount);
			const secondRewardRate = await contract._rewardRate();

			expect(firstRewardRate).to.be.above(0);
			expect(secondRewardRate).to.be.above(firstRewardRate);
		});

		it('rewards token balance should rollover after DURATION', async () => {
			const totalToStake = hre.ethers.utils.parseEther("100");
			await stakingTokenContract.connect(owner).transfer(account1.address, totalToStake);
			await stakingTokenContract.connect(account1).approve(contract.address, hre.ethers.constants.MaxUint256);
			await contract.connect(account1).stake(totalToStake);

			const totalToDistribute = hre.ethers.utils.parseEther("5000");
			await rewardTokenContract.connect(owner).transfer(contract.address, totalToDistribute);
			await contract.notifyRewardAmount(totalToDistribute);

			// wait 10 days (to simulate the end of initial reward duration)
			await time.increase(10 * 24 * 60 * 60);
			
			// get earnings
			const firstRewardEarned = await contract.earned(account1.address);

			// add another batch of rewards and wait again
			await rewardTokenContract.connect(owner).transfer(contract.address, totalToDistribute);
			await contract.notifyRewardAmount(totalToDistribute);
			await time.increase(10 * 24 * 60 * 60);

			const secondRewardEarned = await contract.earned(account1.address);

			// second reward is 2 x first reward because we distributed equal amounts of reward tokens in the two durations
			expect(secondRewardEarned).to.be.equal(firstRewardEarned.add(firstRewardEarned));		
		});
	})

	describe("Withdrawing Earned Rewards => getReward()", async () => {

		it("should set token balances correctly", async () => {
			const stakingAmount = hre.ethers.utils.parseEther("100");
			await stakingTokenContract.connect(owner).transfer(account1.address, stakingAmount);
			await stakingTokenContract.connect(account1).approve(contract.address, stakingAmount);
			await contract.connect(account1).stake(stakingAmount);

			const rewardAmount = hre.ethers.utils.parseEther("500");
			await rewardTokenContract.connect(owner).transfer(contract.address, rewardAmount);
			await contract.connect(owner).notifyRewardAmount(rewardAmount);

			await time.increase(1 * 24 * 60 * 60);

			const accountBalanceBefore = await rewardTokenContract.balanceOf(account1.address);
			const accountRewardsEarned = await contract.earned(account1.address);

			await contract.connect(account1).getReward();
			const accountBalanceAfter = await rewardTokenContract.balanceOf(account1.address);
			const accountRewardsEarnedAfter = await contract.earned(account1.address);

			expect(accountRewardsEarnedAfter).to.be.equal(0);
			expect(accountRewardsEarned).to.be.above(0);
			expect(accountBalanceAfter).to.be.above(accountBalanceBefore);
		});
	})

	describe("Chaning Reward Duration => setRewardsDuration()", async () => {

		const tenDaysInSeconds = 10 * 24 * 60 * 60;
		const hundredDaysInSeconds = 100 * 24 * 60 * 60;

		it("should increase rewards duration before starting distribution (no rewards and staking yet)", async () => {
			const initialDuration = await contract._rewardsDuration();
			expect(initialDuration).to.be.equal(tenDaysInSeconds);

			await contract.connect(owner).setRewardsDuration(100);
			const newDuration = await contract._rewardsDuration();
			expect(newDuration).to.be.equal(hundredDaysInSeconds);
		});

		it("should NOT allow to change the reward duration before the current periods ends", async () => {
			const stakingAmount = hre.ethers.utils.parseEther("100");
			await stakingTokenContract.connect(owner).transfer(account1.address, stakingAmount);
			await stakingTokenContract.connect(account1).approve(contract.address, stakingAmount);
			await contract.connect(account1).stake(stakingAmount);

			const rewardAmount = hre.ethers.utils.parseEther("500");
			await rewardTokenContract.connect(owner).transfer(contract.address, rewardAmount);
			await contract.connect(owner).notifyRewardAmount(rewardAmount);

			await time.increase(1 * 24 * 60 * 60);

			// try changing the duration
			const tx = contract.connect(owner).setRewardsDuration(100);
            await expect(tx).to.be.revertedWith("StakingRewards: previous rewards period must be complete before changing the duration for the new period");
		});

		it("should allow to change the reward duration after the current periods ends", async () => {
			const stakingAmount = hre.ethers.utils.parseEther("100");
			await stakingTokenContract.connect(owner).transfer(account1.address, stakingAmount);
			await stakingTokenContract.connect(account1).approve(contract.address, stakingAmount);
			await contract.connect(account1).stake(stakingAmount);

			const rewardAmount = hre.ethers.utils.parseEther("500");
			await rewardTokenContract.connect(owner).transfer(contract.address, rewardAmount);
			await contract.connect(owner).notifyRewardAmount(rewardAmount);

			// wait 11 days
			await time.increase(11 * 24 * 60 * 60);

			await contract.connect(owner).setRewardsDuration(100);
			const duration = await contract._rewardsDuration();
			expect(duration).to.be.equal(hundredDaysInSeconds);
		});

		it("should emit RewardsDurationUpdated event with correct args", async () => {
			const tx = await contract.connect(owner).setRewardsDuration(100);
            const receipt = await tx.wait();

            const event = receipt.events.find(event => event.event === 'RewardsDurationUpdated')
            const [
                newDuration
            ] = event.args;
            expect(newDuration).to.equal(hundredDaysInSeconds);
		});
	})

	describe("Total Reward To Be Earned => getRewardForDuration()", () => {
		it("should provide correct estimate", async () => {
			const rewardAmount = hre.ethers.utils.parseEther("100");
			await rewardTokenContract.connect(owner).transfer(contract.address, rewardAmount);
			await contract.connect(owner).notifyRewardAmount(rewardAmount);

			const rewardForDuration = await contract.getRewardForDuration();
			const duration = await contract._rewardsDuration();
			const rewardRate = await contract._rewardRate();

			expect(rewardForDuration).to.be.above(0);
			expect(rewardForDuration).to.be.equal(duration.mul(rewardRate));
		});
	});

	describe("Staked Token Withdrawal => withdraw()", () => {

		it("should NOT allow to withdraw 0", async () => {
			const tx = contract.connect(owner).withdraw(0);
            await expect(tx).to.be.revertedWith("StakingRewards: cannot withdraw 0");
		})

		it("should NOT allow to withdraw more than staked", async () => {
			const stakingAmount = hre.ethers.utils.parseEther("1");
			await stakingTokenContract.connect(owner).transfer(account1.address, stakingAmount);
			await stakingTokenContract.connect(account1).approve(contract.address, stakingAmount);
			await contract.connect(account1).stake(stakingAmount);

			const amountToWithdraw = hre.ethers.utils.parseEther("1.1");
			const tx = contract.connect(account1).withdraw(amountToWithdraw);
            await expect(tx).to.be.revertedWith("StakingRewards: cannot withdraw more than staked");
		})

		it("should correctly update balances", async () => {
			const stakingAmount = hre.ethers.utils.parseEther("23");
			await stakingTokenContract.connect(owner).transfer(account1.address, stakingAmount);
			await stakingTokenContract.connect(account1).approve(contract.address, stakingAmount);
			await contract.connect(account1).stake(stakingAmount);

			const accountTokenBalanceBefore = await stakingTokenContract.balanceOf(account1.address);
			const contractTokenBalanceBefore = await stakingTokenContract.balanceOf(contract.address);
			const accontTokenBalanceInContractBefore = await contract.balanceOf(account1.address);

			await contract.connect(account1).withdraw(stakingAmount);

			const accountTokenBalanceAfter = await stakingTokenContract.balanceOf(account1.address);
			const contractTokenBalanceAfter = await stakingTokenContract.balanceOf(contract.address);
			const accontTokenBalanceInContractAfter = await contract.balanceOf(account1.address);

            expect(accountTokenBalanceAfter).to.be.equal(accountTokenBalanceBefore.add(stakingAmount));
			expect(contractTokenBalanceAfter).to.be.equal(contractTokenBalanceBefore.sub(stakingAmount));
			expect(accontTokenBalanceInContractBefore).to.be.equal(stakingAmount);
			expect(accontTokenBalanceInContractAfter).to.be.equal(0);
		})

		it("should emit Withdrawn event with correct args", async () => {
			const stakingAmount = hre.ethers.utils.parseEther("53");
			await stakingTokenContract.connect(owner).transfer(account1.address, stakingAmount);
			await stakingTokenContract.connect(account1).approve(contract.address, stakingAmount);
			await contract.connect(account1).stake(stakingAmount);

			const tx = await contract.connect(account1).withdraw(stakingAmount);
            const receipt = await tx.wait();
            const event = receipt.events.find(event => event.event === 'Withdrawn')
            const [
                user,
				amount
            ] = event.args;

            expect(user).to.equal(account1.address);
			expect(amount).to.equal(stakingAmount);
		});
	})

	describe("Withdraw Everything => exit()", () => {
		it("should retrieve all rewards and withdraw all staked tokens", async () => {

			const stakingAmount = hre.ethers.utils.parseEther("11");
			await stakingTokenContract.connect(owner).transfer(account1.address, stakingAmount);
			await stakingTokenContract.connect(account1).approve(contract.address, stakingAmount);
			await contract.connect(account1).stake(stakingAmount);

			const rewardAmount = hre.ethers.utils.parseEther("500");
			await rewardTokenContract.connect(owner).transfer(contract.address, rewardAmount);
			await contract.connect(owner).notifyRewardAmount(rewardAmount);

			await time.increase(1 * 24 * 60 * 60);

			const accountStakingTokenBalanceBefore = await stakingTokenContract.balanceOf(account1.address);
			const accountRewardTokenBalanceBefore = await rewardTokenContract.balanceOf(account1.address);

			await contract.connect(account1).exit();

			const accountStakingTokenBalanceAfter = await stakingTokenContract.balanceOf(account1.address);
			const accountRewardTokenBalanceAfter = await rewardTokenContract.balanceOf(account1.address);
			const accountBalanceInContract = await contract.balanceOf(account1.address);

            expect(accountStakingTokenBalanceAfter).to.be.equal(accountStakingTokenBalanceBefore.add(stakingAmount));
			expect(accountRewardTokenBalanceBefore).to.be.equal(0);
			expect(accountRewardTokenBalanceAfter).to.be.above(accountRewardTokenBalanceBefore);
			expect(accountBalanceInContract).to.be.equal(0);
		})
	})

	describe("Change The Reward Amount => notifyRewardAmount()", () => {

		it("should NOT allow to change the reward amount if it's greater than the current contract balance", async () => {
			await rewardTokenContract.connect(owner).transfer(contract.address, hre.ethers.utils.parseEther("10"));
			const tx = contract.connect(owner).notifyRewardAmount(hre.ethers.utils.parseEther("11"));
			await expect(tx).to.be.revertedWith("StakingRewards: provided reward too high");
		})
	})

	describe("Staking Scenarios", () => {

		beforeEach(async () => {
			const stakingTokenAmount = hre.ethers.utils.parseEther("1000");
			await stakingTokenContract.connect(owner).transfer(account1.address, stakingTokenAmount);
			await stakingTokenContract.connect(owner).transfer(account2.address, stakingTokenAmount);
			await stakingTokenContract.connect(owner).transfer(account3.address, stakingTokenAmount);

			await stakingTokenContract.connect(account1).approve(contract.address, hre.ethers.constants.MaxUint256);
			await stakingTokenContract.connect(account2).approve(contract.address, hre.ethers.constants.MaxUint256);
			await stakingTokenContract.connect(account3).approve(contract.address, hre.ethers.constants.MaxUint256);

			const rewardAmount = hre.ethers.utils.parseEther("5000");
			await rewardTokenContract.connect(owner).transfer(contract.address, rewardAmount);
			await contract.connect(owner).notifyRewardAmount(rewardAmount);
		});

		it("rewards should be proportional to the amounts staked", async () => {

			await contract.connect(account1).stake(hre.ethers.utils.parseEther("111"));
			await contract.connect(account2).stake(hre.ethers.utils.parseEther("333"));
			await contract.connect(account3).stake(hre.ethers.utils.parseEther("222"));

			await time.increase(1 * 24 * 60 * 60);

			const earnedAccount1 = await contract.earned(account1.address);
			const earnedAccount2 = await contract.earned(account2.address);
			const earnedAccount3 = await contract.earned(account3.address);

			// account2 earned the most, account1 earned the least
            expect(earnedAccount2).to.be.above(earnedAccount3);
			expect(earnedAccount3).to.be.above(earnedAccount1);
		})

		it("rewards should be proportional to the amounts staked even after the reward period ends", async () => {
			
			await contract.connect(account1).stake(hre.ethers.utils.parseEther("555"));
			await contract.connect(account2).stake(hre.ethers.utils.parseEther("111"));
			await contract.connect(account3).stake(hre.ethers.utils.parseEther("444"));

			await time.increase(20 * 24 * 60 * 60);

			const earnedAccount1 = await contract.earned(account1.address);
			const earnedAccount2 = await contract.earned(account2.address);
			const earnedAccount3 = await contract.earned(account3.address);

			// account1 earned the most, account2 earned the least
            expect(earnedAccount1).to.be.above(earnedAccount3);
			expect(earnedAccount3).to.be.above(earnedAccount2);
		})

		it("rewards should be proportional to the time staked", async () => {

			const stakingAmount = hre.ethers.utils.parseEther("100");

			await contract.connect(account1).stake(stakingAmount);
			await contract.connect(account2).stake(stakingAmount);
			await contract.connect(account3).stake(stakingAmount);

			// account 1 withdraws after 1 day
			await time.increase(1 * 24 * 60 * 60);	
			await contract.connect(account1).withdraw(stakingAmount);		

			// account 2 withdraws after one more day
			await time.increase(1 * 24 * 60 * 60);
			await contract.connect(account2).withdraw(stakingAmount);

			// account 3 withdraws after one more day
			await time.increase(1 * 24 * 60 * 60);
			await contract.connect(account3).withdraw(stakingAmount);

			const earnedAccount1 = await contract.earned(account1.address);
			const earnedAccount2 = await contract.earned(account2.address);
			const earnedAccount3 = await contract.earned(account3.address);

			// account3 earned the most, account1 earned the least
            expect(earnedAccount3).to.be.above(earnedAccount2);
			expect(earnedAccount2).to.be.above(earnedAccount1);
		})

		it("rewards earned should NOT exceed rewards allocated", async () => {
			
			await contract.connect(account1).stake(hre.ethers.utils.parseEther("100"));
			await contract.connect(account2).stake(hre.ethers.utils.parseEther("200"));
			await contract.connect(account3).stake(hre.ethers.utils.parseEther("300"));

			await time.increase(20 * 24 * 60 * 60);

			const earnedAccount1 = await contract.earned(account1.address);
			const earnedAccount2 = await contract.earned(account2.address);
			const earnedAccount3 = await contract.earned(account3.address);

			const totalrewardsEarned = earnedAccount1.add(earnedAccount2.add(earnedAccount3));
			const totalrewardAllocated = hre.ethers.utils.parseEther("5000");

            expect(totalrewardAllocated).to.be.above(totalrewardsEarned);
		})
	})
})