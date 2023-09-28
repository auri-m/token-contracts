const hre = require("hardhat");

const REWARD_TOKEN_ADDRESS = "xxxxxxxxxxxxxxxxxx";

const STAKING_TOKEN_ADDRESS = "xxxxxxxxxxxxxxxxxx";

const REWARD_DURATION_IN_DAYS = 7;

const main = async () => {

  try {
    console.log(`Preparing BRACH Rewards deployment...`)

    const breachRewardsFactory = await hre.ethers.getContractFactory("StakingRewards");
    const breachRewardsPromise = await breachRewardsFactory.deploy(REWARD_TOKEN_ADDRESS, STAKING_TOKEN_ADDRESS, REWARD_DURATION_IN_DAYS);
    console.log(`\nDeploying BRACH Rewards contract...`)
    await breachRewardsPromise.deployed();
    console.log(`BRACH Rewards address: ${breachRewardsPromise.address}\n`);

  } catch (error) {
    console.log(error)
    throw error
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });