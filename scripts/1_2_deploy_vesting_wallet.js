const hre = require("hardhat");

const TOKEN_ADDRESS = "xxxxxxxxxxxxxxxxxxxxxxxxxxx"

const main = async () => {

  try {
    console.log(`Preparing vesting wallet deployment...`)

    // vesting wallet deployment
    const vestingWalletFactory = await hre.ethers.getContractFactory("VestingWallet");
    const vestingWalletPromise = await vestingWalletFactory.deploy(TOKEN_ADDRESS);
    console.log(`\nDeploying vesting wallet...`)
    await vestingWalletPromise.deployed();
    console.log(`Vesting wallet address: ${vestingWalletPromise.address}\n`);

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