import { WrappedExchange } from "./wrapper";
import { WebSocketProvider } from "@ethersproject/providers";
import { BigNumber, Wallet } from "ethers";

async function main() {
  const path = `${process.cwd()}/.env`;
  await require("dotenv").config({ path });

  const provider = new WebSocketProvider(process.env.INFURA_WSS, "rinkeby");
  const wallet = new Wallet(`${process.env.DEPLOY_PRIVATE_KEY}`, provider);

  const exchange = new WrappedExchange(wallet, 4);

  const firstHash = await exchange.getOrderHash({
    registry: "0x8f1a5172d229b0A88595A8c8684c30E7C85A10Dc",
    maker: "0xbbd01B9432c1c2565566445040d7eBbE1e0D164e",
    staticTarget: "0x4776ef2201dDd1112328D1A7071aebB4a6159110",
    staticSelector: "0xc3d3626a",
    staticExtradata:
      "0x000000000000000000000000bc83d1be8192ffa1f79f86b91f49f3a6ee67f809000000000000000000000000c778417e063141139fce010982780140aa0cd5ab0000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000016345785d8a0000",
    maximumFill: "1",
    listingTime: 1639605095,
    expirationTime: "1639863720",
    salt: 4096,
  });

  const secondHash = await exchange.getOrderHash({
    salt: 3432,
    maker: "0x65267188212Ff63ad058e3939f85E5Bd4a82e434",
    registry: "0x8f1a5172d229b0A88595A8c8684c30E7C85A10Dc",
    listingTime: 1639604600,
    maximumFill: "100000000000000000",
    staticTarget: "0x4776ef2201dDd1112328D1A7071aebB4a6159110",
    expirationTime: "1639863720",
    staticSelector: "0xa6139b58",
    staticExtradata:
      "0x000000000000000000000000c778417e063141139fce010982780140aa0cd5ab000000000000000000000000bc83d1be8192ffa1f79f86b91f49f3a6ee67f8090000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000016345785d8a0000",
  });

  console.log("first", firstHash);
  console.log("second", secondHash);

  const tx = await exchange.matchOrders(
    "ERC721",
    {
      registry: "0x8f1a5172d229b0A88595A8c8684c30E7C85A10Dc",
      maker: "0xbbd01B9432c1c2565566445040d7eBbE1e0D164e",
      staticTarget: "0x4776ef2201dDd1112328D1A7071aebB4a6159110",
      staticSelector: "0xc3d3626a",
      staticExtradata:
        "0x000000000000000000000000bc83d1be8192ffa1f79f86b91f49f3a6ee67f809000000000000000000000000c778417e063141139fce010982780140aa0cd5ab0000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000016345785d8a0000",
      maximumFill: "1",
      listingTime: 1639605095,
      expirationTime: "1639863720",
      salt: 4096,
    },
    {
      v: 28,
      r: "0xa0648d258a2a99dda5245ff38919da8c38931194e56286eec21e81aa056d1864",
      s: "0x22b3857d823a9baf39249b7c83c8153446e3e5904e963a0fdd5d98425cc08284",
    },
    {
      salt: 3432,
      maker: "0x65267188212Ff63ad058e3939f85E5Bd4a82e434",
      registry: "0x8f1a5172d229b0A88595A8c8684c30E7C85A10Dc",
      listingTime: 1639604600,
      maximumFill: "100000000000000000",
      staticTarget: "0x4776ef2201dDd1112328D1A7071aebB4a6159110",
      expirationTime: "1639863720",
      staticSelector: "0xa6139b58",
      staticExtradata:
        "0x000000000000000000000000c778417e063141139fce010982780140aa0cd5ab000000000000000000000000bc83d1be8192ffa1f79f86b91f49f3a6ee67f8090000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000016345785d8a0000",
    },
    {
      r: "0x44ffc0562fdda03b6ebd31230113158a2822c8a9a953032f6dcb41aa33fa4b1c",
      s: "0x3fcb100b1dcd36e75eab38489cab6de9ad79803ba88a24517b22d664d83db975",
      v: 27,
    },
    BigNumber.from("1")
  );

  console.log("tx", tx);
  await tx.wait();
  //   await tx.wait();
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
