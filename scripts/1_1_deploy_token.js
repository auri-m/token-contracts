const hre = require("hardhat");

const main = async () => {

  try {
    console.log(`Preparing token deployment...`)

    // token deployment
    const tokenFactory = await hre.ethers.getContractFactory("BEP20Token");
    const tokenPromise = await tokenFactory.deploy();
    console.log(`\nDeploying token...`)
    await tokenPromise.deployed();
    console.log(`Token address: ${tokenPromise.address}`);

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