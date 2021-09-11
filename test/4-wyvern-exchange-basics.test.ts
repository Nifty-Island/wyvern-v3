/* global artifacts:false, it:false, contract:false, assert:false */
import { expect, assert} from 'chai';
import { ethers } from 'hardhat';
import '@nomiclabs/hardhat-ethers';
import '@nomiclabs/hardhat-waffle';

import { 
  WyvernRegistry__factory, 
  WyvernRegistry,
  WyvernExchange__factory,
  WyvernExchange
} from '../build/types';

import {
  wrap,
  sign,
  sigBytes,
  hashOrder, 
  hashToSign, 
  ZERO_ADDRESS, 
  ZERO_BYTES32, 
  CHAIN_ID,
} from './auxiliary';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';

describe('WyvernExchange', () => {

  let registry: WyvernRegistry;
  let exchange: WyvernExchange;
  let signers;

  beforeEach(async () => {
    signers = await ethers.getSigners();
    const wyvernRegistryFactory = new WyvernRegistry__factory(signers[0]);
    registry = await wyvernRegistryFactory.deploy();
    await registry.deployed();
    const wyvernExchangeFactory = new WyvernExchange__factory(signers[0]);
    exchange = await wyvernExchangeFactory.deploy(CHAIN_ID, [registry.address], Buffer.from("\x19Ethereum Signed Message:\n", 'binary'));
    await exchange.deployed();
    await registry.grantInitialAuthentication(exchange.address);
    
  })

  it('correctly hashes order',async () => {
    let example = {registry: registry.address,maker: signers[0].address,staticTarget: ZERO_ADDRESS,staticSelector: '0x00000000',staticExtradata: '0x',maximumFill: '1',listingTime: '0',expirationTime: '0',salt: '0'}
    let hash = await exchange.hashOrder_(registry.address, signers[0].address, ZERO_ADDRESS,'0x00000000', '0x', '1', '0', '0', '0')
    assert.equal(hashOrder(example),hash,'Incorrect order hash')
  })

  it('correctly hashes order to sign',async () => {
    let exampleObj = {registry: registry.address,maker: signers[0].address,staticTarget: ZERO_ADDRESS,staticSelector: '0x00000000',staticExtradata: '0x',maximumFill: '1',listingTime: '0',expirationTime: '0',salt: '0'}
    let orderHash = await exchange.hashOrder_(registry.address, signers[0].address, ZERO_ADDRESS, '0x00000000', '0x', '1', '0', '0', '0')
    let signedHash = await exchange.hashToSign_(orderHash)
    let hashToSignResult = hashToSign(exampleObj, exchange.address);
    assert.equal(hashToSignResult,signedHash,'Incorrect order hash')
  })

  it('does not allow set-fill to same fill',async () => {
    let orderHash = await exchange.hashOrder_(registry.address,  signers[1].address,  exchange.address,  '0x00000000',  '0x',  '1',  '0',  '1000000000000',  '6')
    return expect(
      exchange.connect(signers[0]).setOrderFill_(orderHash,'0')
    ).to.be.revertedWith("Fill is already set to the desired value")
  })

  it('validates valid order parameters',async () => {
    assert.isTrue(await exchange.validateOrderParameters_(registry.address, signers[0].address, exchange.address, '0x00000000', '0x', '1', '0', '1000000000000', '0'),'Should have validated')
  })

  it('does not validate order parameters with invalid staticTarget',async () => {
    assert.isFalse(await exchange.validateOrderParameters_(registry.address, signers[0].address, ZERO_ADDRESS, '0x00000000', '0x', '1', '0', '1000000000000', '0'),'Should not have validated')
  })

  it('does not validate order parameters with listingTime after now',async () => {
    assert.isFalse(await exchange.validateOrderParameters_(registry.address, signers[0].address, exchange.address, '0x00000000',  '0x',  '1',  '1000000000000',  '1000000000000',  '0'),'Should not have validated')
  })

  it('validates valid authorization by signature (sign_typed_data)',async () => {
    let example =  {registry: registry.address,maker: signers[1].address,staticTarget: exchange.address,staticSelector: '0x00000000',staticExtradata: '0x',maximumFill: '1',listingTime: '0',expirationTime: '1000000000000',salt: '100230'}
    let signature = await sign(example, signers[1], exchange)
    const decoder = new ethers.utils.AbiCoder();
    let signatureBytes = decoder.encode(['uint8', 'bytes32', 'bytes32'], [signature.v, signature.r, signature.s]) + (signature.suffix || '')
    let hash = hashOrder(example);
    assert.isTrue(await exchange.connect(signers[5]).validateOrderAuthorization_(hash,signers[1].address, signatureBytes),'Should have validated')
  })

  /**
  it('validates valid authorization by signature (personal_sign)',async () => {
    let example = {registry: registry.address,maker: signers[1].address,staticTarget: exchange.address,staticSelector: '0x00000000',staticExtradata: '0x',maximumFill: '1',listingTime: '0',expirationTime: '1000000000000',salt: '100231'}
    let hash = hashOrder(example)
    let personalSignature = await personalSign(example, signers[1], exchange)
    console.log("Personal Signature: ", personalSignature);
    const decoder = new ethers.utils.AbiCoder();
    let signatureBytes = decoder.encode(['uint8', 'bytes32', 'bytes32'], [personalSignature.v, personalSignature.r, personalSignature.s]) + (personalSignature.suffix || '')
    console.log("Signature bytes: ", signatureBytes);
    assert.isTrue(await exchange.connect(signers[5]).validateOrderAuthorization_(hash,signers[1].address, signatureBytes),'Should have validated')
  })

  it('does not validate authorization by signature with different prefix (personal_sign)',async () => {
    const prefix = Buffer.from("\x19Bogus Signed Message:\n",'binary');
    const wyvernRegistryFactory = (await ethers.getContractFactory('WyvernRegistry', signers[0])) as WyvernRegistry__factory;
    let bogusRegistry = await wyvernRegistryFactory.deploy();
    await bogusRegistry.deployed();
    const wyvernExchangeFactory = new WyvernExchange__factory(signers[0]);
    let bogusExchange = await wyvernExchangeFactory.deploy(CHAIN_ID, [bogusRegistry.address], prefix);
    await bogusRegistry.grantInitialAuthentication(bogusExchange.address);
    let example = {registry: bogusRegistry.address,maker: signers[1].address,staticTarget: bogusExchange.address,staticSelector: '0x00000000',staticExtradata: '0x',maximumFill: '1',listingTime: '0',expirationTime: '1000000000000',salt: '100231'}
    let hash = hashOrder(example)
    let personalSignature = await personalSign(example, signers[1], bogusExchange)
    const decoder = new ethers.utils.AbiCoder();
    let signatureBytes = decoder.encode(['uint8', 'bytes32', 'bytes32'], [personalSignature.v, personalSignature.r, personalSignature.s]) + (personalSignature.suffix || '')
    assert.isFalse(await bogusExchange.connect(signers[5]).validateOrderAuthorization_(hash,signers[1].address, signatureBytes),'Should not have validated')
  })
   */
  it('does not allow approval twice',async () => {
    await exchange.connect(signers[1]).approveOrder_(registry.address, signers[1].address,exchange.address,'0x00000000','0x','1','0','1000000000000','1010', false)
    return expect(
      exchange.connect(signers[1]).approveOrder_(registry.address, signers[1].address,exchange.address,'0x00000000','0x','1','0','1000000000000','1010', false)
    ).to.be.revertedWith('Order has already been approved')
  })

  it('does not allow approval from another user',async () => {
    return expect(
      exchange.connect(signers[2]).approveOrder_(registry.address, signers[1].address,  exchange.address, '0x00000000', '0x', '1', '0', '1000000000000',  '10101234',false)
    ).to.be.revertedWith('Sender is not the maker of the order and thus not authorized to approve it')
  })

  it('validates valid authorization by approval',async () => {
    const example = {registry: registry.address, maker: signers[1].address, staticTarget: exchange.address, staticSelector: '0x00000000', staticExtradata: '0x', maximumFill: '1', listingTime: '0', expirationTime: '1000000000000', salt: '10'}
    await exchange.connect(signers[1]).approveOrder_(registry.address, signers[1].address, exchange.address, '0x00000000', '0x',  '1', '0', '1000000000000', '10',false)
    const hash = hashOrder(example)
    const signature = await sigBytes(example, signers[1], exchange)
    let valid = await exchange.validateOrderAuthorization_(hash, signers[0].address, signature);
    assert.isTrue(valid,'Should have validated')
  })

  it('validates valid authorization by hash-approval',async () => {
    const example = {registry: registry.address, maker: signers[1].address, staticTarget: exchange.address, staticSelector: '0x00000000', staticExtradata: '0x', maximumFill: '1', listingTime: '0', expirationTime: '1000000000000', salt: '1'}
    const hash = hashOrder(example)
    await exchange.connect(signers[1]).approveOrderHash_(hash)
    const signature = await sigBytes(example, signers[1], exchange)
    let valid = await exchange.connect(signers[5]).validateOrderAuthorization_(hash,signers[5].address, signature);
    assert.isTrue(valid,'Should have validated')
  })

  it('validates valid authorization by maker',async () => {
    const example = {registry: registry.address, maker: signers[0].address, staticTarget: exchange.address, staticSelector: '0x00000000', staticExtradata: '0x', maximumFill: '1', listingTime: '0', expirationTime: '1000000000000', salt: '5'}
    const hash = hashOrder(example)
    const signature = await sigBytes(example, signers[1], exchange)
    let valid = await exchange.connect(signers[0]).validateOrderAuthorization_(hash, signers[0].address, signature)
    assert.isTrue(valid,'Should have validated')
  })

  it('validates valid authorization by cache',async () => {
    const example = {registry: registry.address, maker: signers[1].address, staticTarget: exchange.address, staticSelector: '0x00000000', staticExtradata: '0x', maximumFill: '1', listingTime: '0', expirationTime: '1000000000000', salt: '6'}
    const hash = hashOrder(example)
    await exchange.connect(signers[1]).setOrderFill_(hash, '2')
    const signature = await sigBytes(example, signers[1], exchange)
    let valid = await exchange.connect(signers[0]).validateOrderAuthorization_(hash, signers[0].address, signature)
    assert.isTrue(valid,'Should have validated')
  })

  it('does not validate authorization without signature', async () => {
    const example = {registry: registry.address, maker: signers[1].address, staticTarget: exchange.address, staticSelector: '0x00000000', staticExtradata: '0x', maximumFill: '1', listingTime: '0', expirationTime: '1000000000000', salt: '0'}
    const hash = hashOrder(example)
    let signature = await sign(example, signers[1], exchange)
    const decoder = new ethers.utils.AbiCoder();
    let bogusSignature = decoder.encode(['uint8', 'bytes32', 'bytes32'], [27, ZERO_BYTES32, ZERO_BYTES32]) + ('')
    let valid = await exchange.validateOrderAuthorization_(hash, signers[1].address, bogusSignature)
    assert.isFalse(valid,'Should not have validated')    
  })

  it('does not validate cancelled order',async () => {
    const example = {registry: registry.address, maker: signers[0].address, staticTarget: exchange.address, staticSelector: '0x00000000', staticExtradata: '0x', maximumFill: '1', listingTime: '0', expirationTime: '1000000000000', salt: '20'}
    const hash = hashOrder(example)
    await exchange.setOrderFill_(hash, 1)
    let valid = await exchange.validateOrderParameters_(registry.address, signers[0].address, exchange.address, '0x00000000', '0x', '1', '0', '1000000000000', '20')
    assert.isFalse(valid,'Should not have validated')
  })

  it('allows order cancellation by maker',async () => {
    const example = {registry: registry.address, maker: signers[0].address, staticTarget: exchange.address, staticSelector: '0x00000000', staticExtradata: '0x', maximumFill: '1', listingTime: '0', expirationTime: '1000000000000', salt: '3'}
    const hash = hashOrder(example)
    assert.isOk(await exchange.setOrderFill_(hash, 1))
  })

  it('allows order cancellation by non-maker',async () => {
    const example = {registry: registry.address, maker: signers[1].address, staticTarget: exchange.address, staticSelector: '0x00000000', staticExtradata: '0x', maximumFill: '1', listingTime: '0', expirationTime: '1000000000000', salt: '4'}
    const hash = hashOrder(example)
    assert.isOk(await exchange.setOrderFill_(hash, 1))
  })
})
