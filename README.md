# BEP20Token Sample Hardhat Project

Install the dependencies
```shell
npm install
``` 

Create a local ".env" file. Copy the existing ".env-example.txt", rename it to ".env" and fill in the values. 


Start a local hardhat blockchain node. This takes "hardhat.config.js" and .env configuration into account
```shell
npx hardhat node
``` 

Run all tests
```shell
npx hardhat test
```

Deploy token contract to the local network. 
```shell
npx hardhat run scripts/1_1_deploy_token.js --network localhost
```

Deploy vesting wallet contract to the local network. Need to add token address.
```shell
npx hardhat run scripts/1_2_deploy_vesting_wallet.js --network localhost
```

Deploy staking contract to the local network. Need to add staking and reward token address.
```shell
npx hardhat run scripts/1_3_deploy_staking.js --network localhost
```