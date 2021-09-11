/* global artifacts:false, it:false, contract:false, assert:false */
import { expect, assert} from 'chai';
import { ethers } from 'hardhat';
import '@nomiclabs/hardhat-ethers';
import '@nomiclabs/hardhat-waffle';

import { 
  WyvernAtomicizer__factory,
  WyvernAtomicizer,
  WyvernExchange__factory,
  WyvernExchange,
  WyvernStatic__factory,
  WyvernStatic,
  WyvernRegistry__factory, 
  WyvernRegistry,
  TestERC20__factory,
  TestERC20,
  TestERC721__factory,
  TestERC721,
  TestERC1271__factory,
  TestERC1271
} from '../build/types';

import { 
  wrap,
  sign,
  hashOrder,
  ZERO_BYTES32,
  CHAIN_ID,
  randomUint,
  NULL_SIG
} from './auxiliary'

describe('WyvernExchange', () => {

  let registry: WyvernRegistry;
  let exchange: WyvernExchange;
  let atomicizer: WyvernAtomicizer;
  let statici: WyvernStatic;
  let erc20: TestERC20;
  let erc721: TestERC721;
  let erc1271: TestERC1271;
  let signers;
  let wrappedExchange;
  const decoder = new ethers.utils.AbiCoder();

  beforeEach(async () => {
    signers = await ethers.getSigners();
    const wyvernRegistryFactory = new WyvernRegistry__factory(signers[0]);
    registry = await wyvernRegistryFactory.deploy();
    await registry.deployed();
    const wyvernExchangeFactory = new WyvernExchange__factory(signers[0]);
    exchange = await wyvernExchangeFactory.deploy(CHAIN_ID, [registry.address], Buffer.from("\x19Ethereum Signed Message:\n", 'binary'));
    await exchange.deployed();
    await registry.grantInitialAuthentication(exchange.address);
    const wyvernAtomicizer = new WyvernAtomicizer__factory(signers[0])
    atomicizer = await wyvernAtomicizer.deploy();
    await atomicizer.deployed()
    const wyvernStatic = new WyvernStatic__factory(signers[0]);
    statici = await wyvernStatic.deploy(atomicizer.address);
    await statici.deployed()
    const erc20Factory = new TestERC20__factory(signers[0]);
    erc20 = await erc20Factory.deploy();
    await erc20.deployed()
    const erc721Factory = new TestERC721__factory(signers[0]);
    erc721 = await erc721Factory.deploy();
    await erc721.deployed()
    const erc1271Factory = new TestERC1271__factory(signers[0]);
    erc1271 = await erc1271Factory.deploy();
    await erc1271.deployed();
    wrappedExchange = wrap(exchange)
  })
  
  // Returns an array of two NFTs, one to give and one to get
  const withAsymmetricalTokens = async () => {
    const erc721Factory = new TestERC721__factory(signers[0]);
    let newERC721 = await erc721Factory.deploy();
    let nfts = [4,5]
    await Promise.all([newERC721.mint(signers[0].address, nfts[0]),newERC721.mint(signers[6].address, nfts[1])])
    return {nfts,newERC721}
  }

  const withAsymmetricalTokens2 = async () => {
    const erc721Factory = new TestERC721__factory(signers[0]);
    let newERC721 = await erc721Factory.deploy();
    let nfts = [6,7]
    await Promise.all([newERC721.mint(signers[0].address, nfts[0]),newERC721.mint(signers[6].address, nfts[1])])
    return {nfts,newERC721}
  }

  const withSomeTokens = async () => {
    const erc20Factory = new TestERC20__factory(signers[0]);
    let newERC20 = await erc20Factory.deploy();
    const erc721Factory = new TestERC721__factory(signers[0]);
    let newERC721 = await erc721Factory.deploy();
    const amount = randomUint() + 2
    await newERC20.mint(signers[0].address,amount)
    return {tokens: amount, nfts: [1, 2, 3], newERC20, newERC721}
  }

  it('allows proxy transfer approval',async () => {
    await registry.connect(signers[0]).registerProxy()
    let proxy = await registry.proxies(signers[0].address)
    assert.isTrue(proxy.length > 0,'No proxy address')
    assert.isOk(await erc20.approve(proxy, 100000))
    assert.isOk(await erc721.setApprovalForAll(proxy, true))
  })

  it('allows proxy registration',async () => {
    await registry.connect(signers[6]).registerProxy()
    let proxy = await registry.proxies(signers[6].address)
    assert.isTrue(proxy.length > 0,'No proxy address')
    assert.isOk(await erc20.connect(signers[6]).approve(proxy, 100000))
    assert.isOk(await erc721.connect(signers[6]).setApprovalForAll(proxy, true))
  })

  it('allows proxy registration, erc1271',async () => {
    await registry.registerProxyFor(erc1271.address)
    let proxy = await registry.proxies(erc1271.address)
    assert.isTrue(proxy.length > 0,'No proxy address')
  })

  it('matches any-any nop order',async () => {
    await registry.connect(signers[0]).registerProxy()
    const selector = statici.interface.getSighash('any(bytes,address[7],uint8[2],uint256[6],bytes,bytes)')
    const one = {registry: registry.address, maker: signers[0].address, staticTarget: statici.address, staticSelector: selector, staticExtradata: '0x', maximumFill: '1', listingTime: '0', expirationTime: '100000000000', salt: '0'}
    const two = {registry: registry.address, maker: signers[0].address, staticTarget: statici.address, staticSelector: selector, staticExtradata: '0x', maximumFill: '1', listingTime: '0', expirationTime: '100000000000', salt: '1'}
    const call = {target: statici.address, howToCall: 0, data: statici.interface.getSighash('test()')}
    assert.isOk(await wrappedExchange.atomicMatch(one, NULL_SIG, call, two, NULL_SIG, call, ZERO_BYTES32))
  })

  it('does not match any-any nop order with wrong registry',async () => {
    await registry.connect(signers[0]).registerProxy()
    const selector = statici.interface.getSighash('any(bytes,address[7],uint8[2],uint256[6],bytes,bytes)')
    const one = {registry: registry.address, maker: signers[0].address, staticTarget: statici.address, staticSelector: selector, staticExtradata: '0x', maximumFill: '1', listingTime: '0', expirationTime: '100000000000', salt: '2330'}
    const two = {registry: statici.address, maker: signers[0].address, staticTarget: statici.address, staticSelector: selector, staticExtradata: '0x', maximumFill: '1', listingTime: '0', expirationTime: '100000000000', salt: '2331'}
    const call = {target: statici.address, howToCall: 0, data: statici.interface.getSighash('test()')}
    return expect(
      wrappedExchange.atomicMatch(one, NULL_SIG, call, two, NULL_SIG, call, ZERO_BYTES32)
    ).to.be.revertedWith('Transaction reverted without a reason string')
  })

  it('matches any-any nop order, erc 1271',async () => {
    await registry.connect(signers[0]).registerProxy()
    await erc1271.setOwner(signers[0].address)
    await registry.registerProxyFor(erc1271.address)
    const selector = statici.interface.getSighash('any(bytes,address[7],uint8[2],uint256[6],bytes,bytes)')
    const one = {registry: registry.address, maker: erc1271.address, staticTarget: statici.address, staticSelector: selector, staticExtradata: '0x', maximumFill: '1', listingTime: '0', expirationTime: '100000000000', salt: '410'}
    const two = {registry: registry.address, maker: signers[0].address, staticTarget: statici.address, staticSelector: selector, staticExtradata: '0x', maximumFill: '1', listingTime: '0', expirationTime: '100000000000', salt: '411'}
    const call = {target: statici.address, howToCall: 0, data: statici.interface.getSighash('test()')}
    let signature = await wrappedExchange.sign(one, signers[0])
    assert.isOk(await wrappedExchange.atomicMatch(one, signature, call, two, NULL_SIG, call, ZERO_BYTES32))
  })

  it('does not match any-any nop order with bad sig, erc 1271',async () => {
    await registry.connect(signers[0]).registerProxy()
    await erc1271.setOwner(signers[0].address)
    await registry.registerProxyFor(erc1271.address)
    const selector = statici.interface.getSighash('any(bytes,address[7],uint8[2],uint256[6],bytes,bytes)')
    const one = {registry: registry.address, maker: erc1271.address, staticTarget: statici.address, staticSelector: selector, staticExtradata: '0x', maximumFill: '1', listingTime: '0', expirationTime: '100000000000', salt: '410'}
    const two = {registry: registry.address, maker: signers[0].address, staticTarget: statici.address, staticSelector: selector, staticExtradata: '0x', maximumFill: '1', listingTime: '0', expirationTime: '100000000000', salt: '411'}
    const call = {target: statici.address, howToCall: 0, data: statici.interface.getSighash('test()')}
    let signature1 = await wrappedExchange.sign(one, signers[0])
    await wrappedExchange.atomicMatch(one, signature1, call, two, NULL_SIG, call, ZERO_BYTES32)
    let signature2 = await wrappedExchange.sign(two, signers[0])
    return expect(
      wrappedExchange.atomicMatch(one, signature2, call, two, NULL_SIG, call, ZERO_BYTES32)
    ).to.be.revertedWith('First order has invalid parameters')
  })

  it('matches any-any nop order twice with no fill',async () => {
    await registry.connect(signers[0]).registerProxy()
    const selector = statici.interface.getSighash('anyNoFill(bytes,address[7],uint8[2],uint256[6],bytes,bytes)')
    const one = {registry: registry.address, maker: signers[0].address, staticTarget: statici.address, staticSelector: selector, staticExtradata: '0x', maximumFill: '1', listingTime: '0', expirationTime: '100000000000', salt: randomUint()}
    const two = {registry: registry.address, maker: signers[0].address, staticTarget: statici.address, staticSelector: selector, staticExtradata: '0x', maximumFill: '1', listingTime: '0', expirationTime: '100000000000', salt: randomUint()}
    const call = {target: statici.address, howToCall: 0, data: statici.interface.getSighash('test()')}
    assert.isOk(await wrappedExchange.atomicMatch(one, NULL_SIG, call, two, NULL_SIG, call, ZERO_BYTES32))
    assert.isOk(await wrappedExchange.atomicMatch(one, NULL_SIG, call, two, NULL_SIG, call, ZERO_BYTES32))
  })

  it('matches exactly twice with two-fill',async () => {
    await registry.connect(signers[6]).registerProxy()
    const selector = statici.interface.getSighash('anyAddOne(bytes,address[7],uint8[2],uint256[6],bytes,bytes)')
    const one = {registry: registry.address, maker: signers[6].address, staticTarget: statici.address, staticSelector: selector, staticExtradata: '0x', maximumFill: '2', listingTime: '0', expirationTime: '100000000000', salt: randomUint()}
    const two = {registry: registry.address, maker: signers[6].address, staticTarget: statici.address, staticSelector: selector, staticExtradata: '0x', maximumFill: '2', listingTime: '0', expirationTime: '100000000000', salt: randomUint()}
    const call = {target: statici.address, howToCall: 0, data: statici.interface.getSighash('test()')}
    let [signature1,signature2] = await Promise.all([wrappedExchange.sign(one, signers[6]),wrappedExchange.sign(two, signers[6])])
    await Promise.all(
      [
        wrappedExchange.atomicMatch(one, signature1, call, two, signature2, call, ZERO_BYTES32),
        wrappedExchange.atomicMatch(one, signature1, call, two, signature2, call, ZERO_BYTES32)
      ])
    return expect(
      wrappedExchange.atomicMatch(one, signature1, call, two, signature2, call, ZERO_BYTES32)
    ).to.be.revertedWith('First order has invalid parameters')
  })

  it('should not self-match',async () => {
    const selector = statici.interface.getSighash('any(bytes,address[7],uint8[2],uint256[6],bytes,bytes)')
    const one = {registry: registry.address, maker: signers[0].address, staticTarget: statici.address, staticSelector: selector, staticExtradata: '0x', maximumFill: '1', listingTime: '0', expirationTime: '100000000000', salt: '0'}
    const call = {target: statici.address, howToCall: 0, data: statici.interface.getSighash('test()')}
    return expect(
      wrappedExchange.atomicMatch(one, NULL_SIG, call, one, NULL_SIG, call, ZERO_BYTES32)
    ).to.be.revertedWith('Self-matching orders is prohibited')
  })

  it('does not match any-any reentrant order',async () => {
    await registry.connect(signers[0]).registerProxy()
    const selector = statici.interface.getSighash('any(bytes,address[7],uint8[2],uint256[6],bytes,bytes)')
    const one = {registry: registry.address, maker: signers[0].address, staticTarget: statici.address, staticSelector: selector, staticExtradata: '0x', maximumFill: '1', listingTime: '0', expirationTime: '100000000000', salt: '4'}
    const two = {registry: registry.address, maker: signers[0].address, staticTarget: statici.address, staticSelector: selector, staticExtradata: '0x', maximumFill: '1', listingTime: '0', expirationTime: '100000000000', salt: '5'}
    const call1 = {target: statici.address, howToCall: 0, data: statici.interface.getSighash('test()')}
    const data = exchange.interface.encodeFunctionData('atomicMatch_',[
    [one.registry, one.maker, one.staticTarget, one.maximumFill, one.listingTime, one.expirationTime, one.salt, call1.target,
      two.registry, two.maker, two.staticTarget, two.maximumFill, two.listingTime, two.expirationTime, two.salt, call1.target],
    [one.staticSelector, two.staticSelector],
    one.staticExtradata, call1.data, two.staticExtradata, call1.data,
    [call1.howToCall, call1.howToCall],
    ZERO_BYTES32,
    decoder.encode(['bytes', 'bytes'], [
      decoder.encode(['uint8', 'bytes32', 'bytes32'], [NULL_SIG.v, NULL_SIG.r, NULL_SIG.s]),
      decoder.encode(['uint8', 'bytes32', 'bytes32'], [NULL_SIG.v, NULL_SIG.r, NULL_SIG.s])
    ])]);
    const call2 = {target: exchange.address, howToCall: 0, data: data}
    return expect(
      wrappedExchange.atomicMatch(one, NULL_SIG, call1, two, NULL_SIG, call2, ZERO_BYTES32)
    ).to.be.revertedWith('Second call failed')
  })

  it('matches nft-nft swap order',async () => {
    await registry.connect(signers[0]).registerProxy()
    await registry.connect(signers[6]).registerProxy()

    let {nfts, newERC721} = await withAsymmetricalTokens()
    const erc721Factory = new TestERC721__factory(signers[0]);
    const erc721c  = await erc721Factory.deploy();
    await erc721c.deployed()

    let proxy1 = await registry.proxies(signers[0].address)
    assert.isTrue(proxy1.length > 0,'No proxy address')
    assert.isOk(await newERC721.connect(signers[0]).setApprovalForAll(proxy1, true))

    let proxy2 = await registry.proxies(signers[6].address)
    assert.isTrue(proxy2.length > 0,'No proxy address')
    assert.isOk(await newERC721.connect(signers[6]).setApprovalForAll(proxy2, true))
    
    const selector = statici.interface.getSighash('swapOneForOneERC721(bytes,address[7],uint8[2],uint256[6],bytes,bytes)')
    const paramsOne = decoder.encode(
      ['address[2]', 'uint256[2]'],
      [[newERC721.address, newERC721.address], [nfts[0], nfts[1]]]
    )
    const paramsTwo = decoder.encode(
      ['address[2]', 'uint256[2]'],
      [[newERC721.address, newERC721.address], [nfts[1], nfts[0]]]
    )
    const one = {registry: registry.address, maker: signers[0].address, staticTarget: statici.address, staticSelector: selector, staticExtradata: paramsOne, maximumFill: '1', listingTime: '0', expirationTime: '10000000000', salt: '2'}
    const two = {registry: registry.address, maker: signers[6].address, staticTarget: statici.address, staticSelector: selector, staticExtradata: paramsTwo, maximumFill: '1', listingTime: '0', expirationTime: '10000000000', salt: '3'}

    const firstData = erc721c.interface.encodeFunctionData('transferFrom', [signers[0].address, signers[6].address, nfts[0]])
    const secondData =  erc721c.interface.encodeFunctionData('transferFrom',[signers[6].address, signers[0].address, nfts[1]])

    const firstCall = {target: newERC721.address, howToCall: 0, data: firstData}
    const secondCall = {target: newERC721.address, howToCall: 0, data: secondData}
    const sigOne = NULL_SIG
    
    let sigTwo = await wrappedExchange.sign(two, signers[6])
    await wrappedExchange.atomicMatch(one, sigOne, firstCall, two, sigTwo, secondCall, ZERO_BYTES32, {from: signers[6]})
    assert.equal(await newERC721.ownerOf(nfts[0]), signers[6].address, 'Incorrect owner')
  })

  it('matches nft-nft swap order, abi-decoding instead',async () => {
    await registry.connect(signers[0]).registerProxy()
    await registry.connect(signers[6]).registerProxy()

    let {nfts, newERC721} = await withAsymmetricalTokens2()
    const erc721Factory = new TestERC721__factory(signers[0]);
    const erc721c  = await erc721Factory.deploy();
    await erc721c.deployed()

    let proxy1 = await registry.proxies(signers[0].address)
    assert.isTrue(proxy1.length > 0,'No proxy address')
    assert.isOk(await newERC721.connect(signers[0]).setApprovalForAll(proxy1, true))

    let proxy2 = await registry.proxies(signers[6].address)
    assert.isTrue(proxy2.length > 0,'No proxy address')
    assert.isOk(await newERC721.connect(signers[6]).setApprovalForAll(proxy2, true))

    const selector = statici.interface.getSighash('swapOneForOneERC721Decoding(bytes,address[7],uint8[2],uint256[6],bytes,bytes)')
    const paramsOne = decoder.encode(
      ['address[2]', 'uint256[2]'],
      [[newERC721.address, newERC721.address], [nfts[0], nfts[1]]]
    )
    const paramsTwo = decoder.encode(
      ['address[2]', 'uint256[2]'],
      [[newERC721.address, newERC721.address], [nfts[1], nfts[0]]]
    )

    const one = {registry: registry.address, maker: signers[0].address, staticTarget: statici.address, staticSelector: selector, staticExtradata: paramsOne, maximumFill: '1', listingTime: '0', expirationTime: '10000000000', salt: '333123'}
    const two = {registry: registry.address, maker: signers[6].address, staticTarget: statici.address, staticSelector: selector, staticExtradata: paramsTwo, maximumFill: '1', listingTime: '0', expirationTime: '10000000000', salt: '123344'}

    const firstData = erc721c.interface.encodeFunctionData('transferFrom',[signers[0].address, signers[6].address, nfts[0]])
    const secondData = erc721c.interface.encodeFunctionData('transferFrom',[signers[6].address, signers[0].address, nfts[1]])

    const firstCall = {target: newERC721.address, howToCall: 0, data: firstData}
    const secondCall = {target: newERC721.address, howToCall: 0, data: secondData}
    const sigOne = NULL_SIG
    
    let sigTwo = await wrappedExchange.sign(two, signers[6])
    await wrappedExchange.atomicMatch(one, sigOne, firstCall, two, sigTwo, secondCall, ZERO_BYTES32, { from: signers[6]})
    assert.equal(await newERC721.ownerOf(nfts[0]), signers[6].address, 'Incorrect owner')
  })

  it('matches two nft + erc20 orders',async () => {
    await registry.connect(signers[0]).registerProxy()
    await registry.connect(signers[6]).registerProxy()
    let {tokens, nfts, newERC20, newERC721} = await withSomeTokens()

    let proxy1 = await registry.proxies(signers[0].address)
    assert.isTrue(proxy1.length > 0,'No proxy address')
    assert.isOk(await newERC20.approve(proxy1, 100000))
    assert.isOk(await newERC721.setApprovalForAll(proxy1, true))

    let proxy2 = await registry.proxies(signers[0].address)
    assert.isTrue(proxy2.length > 0,'No proxy address')
    assert.isOk(await newERC20.approve(proxy2, 100000))
    assert.isOk(await newERC721.setApprovalForAll(proxy2, true))

    const erc721Factory = new TestERC721__factory(signers[0]);
    const erc721c  = await erc721Factory.deploy();
    await erc721c.deployed()
    const atomicizercFactory = new WyvernAtomicizer__factory(signers[0]);
    const atomicizerc  = await atomicizercFactory.deploy();
    await atomicizerc.deployed()
    const erc20Factory = new TestERC721__factory(signers[0]);
    const erc20c  = await erc20Factory.deploy();
    await erc20c.deployed()
    const selector = statici.interface.getSighash('any(bytes,address[7],uint8[2],uint256[6],bytes,bytes)')
    const one = {registry: registry.address, maker: signers[0].address, staticTarget: statici.address, staticSelector: selector, staticExtradata: '0x', maximumFill: '1', listingTime: '0', expirationTime: '10000000000', salt: '2'}
    const two = {registry: registry.address, maker: signers[0].address, staticTarget: statici.address, staticSelector: selector, staticExtradata: '0x', maximumFill: '1', listingTime: '0', expirationTime: '10000000000', salt: '3'}
    const sig = NULL_SIG
    
    const firstERC20Call = erc20c.interface.encodeFunctionData('transferFrom',[signers[0].address, signers[6].address, 2])
    const firstERC721Call = erc721c.interface.encodeFunctionData('transferFrom',[signers[0].address, signers[6].address, nfts[0]])
    const firstData = atomicizerc.interface.encodeFunctionData('atomicize',[
      [newERC20.address, newERC721.address],
      [0, 0],
      [(firstERC20Call.length - 2) / 2, (firstERC721Call.length - 2) / 2],
      firstERC20Call + firstERC721Call.slice(2)
    ])
    
    const secondERC20Call = erc20c.interface.encodeFunctionData('transferFrom',[signers[0].address, signers[2].address, 2])
    const secondERC721Call = erc721c.interface.encodeFunctionData('transferFrom', [signers[0].address, signers[2].address, nfts[1]])
    const secondData = atomicizerc.interface.encodeFunctionData('atomicize',[
      [newERC721.address, newERC20.address],
      [0, 0],
      [(secondERC721Call.length - 2) / 2, (secondERC20Call.length - 2) / 2],
      secondERC721Call + secondERC20Call.slice(2)
    ])
    
    const firstCall = {target: atomicizer.address, howToCall: 1, data: firstData}
    const secondCall = {target: atomicizer.address, howToCall: 1, data: secondData}
    
    assert.isOk(await wrappedExchange.atomicMatch(one, sig, firstCall, two, sig, secondCall, ZERO_BYTES32))
  })

  //This test is ignored, since it has no assertion in the original wyvern v3.1 code
  /*it('matches erc20-erc20 swap order',async () => {
    await registry.connect(signers[0]).registerProxy()
    await registry.connect(signers[6]).registerProxy()
    let {erc20} = await withTokens()    
    const erc20Factory = new TestERC721__factory(signers[0]);
    const erc20c  = await erc20Factory.deploy();
    await erc20c.deployed();

    const selector = statici.interface.getSighash('swapExact(bytes,address[7],uint8[2],uint256[6],bytes,bytes)')
    const paramsOne = decoder.encode(
      ['address[2]', 'uint256[2]'],
      [[erc20.address, erc20.address], ['1', '2']]
    )
    const paramsTwo = decoder.encode(
      ['address[2]', 'uint256[2]'],
      [[erc20.address, erc20.address], ['2', '1']]
    )

    const one = {registry: registry.address, maker: signers[0].address, staticTarget: statici.address, staticSelector: selector, staticExtradata: paramsOne, maximumFill: '1', listingTime: '0', expirationTime: '10000000000', salt: '412312'}
    const two = {registry: registry.address, maker: signers[6].address, staticTarget: statici.address, staticSelector: selector, staticExtradata: paramsTwo, maximumFill: '1', listingTime: '0', expirationTime: '10000000000', salt: '4434'}

    const firstData = erc20c.interface.encodeFunctionData('transferFrom',[signers[0].address, signers[6].address, 1])
    const secondData = erc20c.interface.encodeFunctionData('transferFrom',[signers[6].address, signers[0].address, 2])

    const firstCall = {target: erc20.address, howToCall: 0, data: firstData}
    const secondCall = {target: erc20.address, howToCall: 0, data: secondData}
    const sigOne = NULL_SIG
    
    let sigTwo = await wrappedExchange.sign(two, signers[6])
    await wrappedExchange.atomicMatch(one, sigOne, firstCall, two, sigTwo, secondCall, ZERO_BYTES32)
    //TODO: missing assertion
  })*/

  it('matches with signatures',async () => {
    await registry.connect(signers[6]).registerProxy()
    const selector = statici.interface.getSighash('any(bytes,address[7],uint8[2],uint256[6],bytes,bytes)')
    const one = {registry: registry.address, maker: signers[6].address, staticTarget: statici.address, staticSelector: selector, staticExtradata: '0x', maximumFill: '1', listingTime: '0', expirationTime: '100000000000', salt: 2344}
    const two = {registry: registry.address, maker: signers[6].address, staticTarget: statici.address, staticSelector: selector, staticExtradata: '0x', maximumFill: '1', listingTime: '0', expirationTime: '100000000000', salt: 2345}
    
    let [oneSig,twoSig] = await Promise.all([wrappedExchange.sign(one, signers[6]),wrappedExchange.sign(two, signers[6])])
    const call = {target: statici.address, howToCall: 0, data: statici.interface.getSighash('test()')}
    assert.isOk(await wrappedExchange.atomicMatch(one, oneSig, call, two, twoSig, call, ZERO_BYTES32))
  })

  it('should not match with signatures twice',async () => {
    await registry.connect(signers[6]).registerProxy()
    const selector = statici.interface.getSighash('any(bytes,address[7],uint8[2],uint256[6],bytes,bytes)')
    const one = {registry: registry.address, maker: signers[6].address, staticTarget: statici.address, staticSelector: selector, staticExtradata: '0x', maximumFill: '1', listingTime: '0', expirationTime: '100000000000', salt: 2344}
    const two = {registry: registry.address, maker: signers[6].address, staticTarget: statici.address, staticSelector: selector, staticExtradata: '0x', maximumFill: '1', listingTime: '0', expirationTime: '100000000000', salt: 2345}
    
    let [oneSig,twoSig] = await Promise.all([wrappedExchange.sign(one, signers[6]),wrappedExchange.sign(two, signers[6])])
    const call = {target: statici.address, howToCall: 0, data: statici.interface.getSighash('test()')}
    assert.isOk(await wrappedExchange.atomicMatch(one, oneSig, call, two, twoSig, call, ZERO_BYTES32))
    
    let [oneSig2,twoSig2] = await Promise.all([wrappedExchange.sign(one, signers[6]),wrappedExchange.sign(two, signers[6])])
    const call2 = {target: statici.address, howToCall: 0, data: statici.interface.getSighash('test()')}
    return expect(
      wrappedExchange.atomicMatch(one, oneSig2, call2, two, twoSig2, call, ZERO_BYTES32)
    ).to.be.revertedWith('First order has invalid parameters')
  })

  it('matches with signatures no-fill',async () => {
    await registry.connect(signers[6]).registerProxy()
    const selector = statici.interface.getSighash('anyNoFill(bytes,address[7],uint8[2],uint256[6],bytes,bytes)')
    const one = {registry: registry.address, maker: signers[6].address, staticTarget: statici.address, staticSelector: selector, staticExtradata: '0x', maximumFill: '1', listingTime: '0', expirationTime: '100000000000', salt: randomUint()}
    const two = {registry: registry.address, maker: signers[6].address, staticTarget: statici.address, staticSelector: selector, staticExtradata: '0x', maximumFill: '1', listingTime: '0', expirationTime: '100000000000', salt: randomUint()}
    
    let [oneSig,twoSig] = await Promise.all([wrappedExchange.sign(one, signers[6]),wrappedExchange.sign(two, signers[6])])
    const call = {target: statici.address, howToCall: 0, data: statici.interface.getSighash('test()')}
    assert.isOk(await wrappedExchange.atomicMatch(one, oneSig, call, two, twoSig, call, ZERO_BYTES32))
  })

  it('should match with signatures no-fill, value',async () => {
    await registry.connect(signers[6]).registerProxy()
    const selector = statici.interface.getSighash('anyNoFill(bytes,address[7],uint8[2],uint256[6],bytes,bytes)')
    const one = {registry: registry.address, maker: signers[6].address, staticTarget: statici.address, staticSelector: selector, staticExtradata: '0x', maximumFill: '1', listingTime: '0', expirationTime: '100000000000', salt: randomUint()}
    const two = {registry: registry.address, maker: signers[6].address, staticTarget: statici.address, staticSelector: selector, staticExtradata: '0x', maximumFill: '1', listingTime: '0', expirationTime: '100000000000', salt: randomUint()}
    
    let [oneSig,twoSig] = await Promise.all([wrappedExchange.sign(one, signers[6]),wrappedExchange.sign(two, signers[6])])
    const call = {target: statici.address, howToCall: 0, data: statici.interface.getSighash('test()')}
    assert.isOk(wrappedExchange.atomicMatchWith(one, oneSig, call, two, twoSig, call, ZERO_BYTES32, {from: signers[6], value: 3}))
  })

  it('should match with approvals',async () => {
    await registry.connect(signers[6]).registerProxy()
    const selector = statici.interface.getSighash('any(bytes,address[7],uint8[2],uint256[6],bytes,bytes)')
    const one = {registry: registry.address, maker: signers[6].address, staticTarget: statici.address, staticSelector: selector, staticExtradata: '0x', maximumFill: '1', listingTime: '0', expirationTime: '100000000000', salt: randomUint()}
    const two = {registry: registry.address, maker: signers[6].address, staticTarget: statici.address, staticSelector: selector, staticExtradata: '0x', maximumFill: '1', listingTime: '0', expirationTime: '100000000000', salt: randomUint()}
    
    await Promise.all([wrappedExchange.approveOrder(one, false, {from: signers[6]}),wrappedExchange.approveOrder(two, false, {from: signers[6]})])
    const call = {target: statici.address, howToCall: 0, data: statici.interface.getSighash('test()')}
    assert.isOk(wrappedExchange.atomicMatchWith(one, NULL_SIG, call, two, NULL_SIG, call, ZERO_BYTES32, { from: signers[6]}))
  })

  it('does not match with invalid first order auth',async () => {
    const selector = statici.interface.getSighash('any(bytes,address[7],uint8[2],uint256[6],bytes,bytes)')
    const one = {registry: registry.address, maker: signers[6].address, staticTarget: statici.address, staticSelector: selector, staticExtradata: '0x', maximumFill: '1', listingTime: '0', expirationTime: '100000000000', salt: randomUint()}
    const two = {registry: registry.address, maker: signers[6].address, staticTarget: statici.address, staticSelector: selector, staticExtradata: '0x', maximumFill: '1', listingTime: '0', expirationTime: '100000000000', salt: randomUint()}
    
    let signature = await wrappedExchange.sign(one, signers[6])
    const call = {target: statici.address, howToCall: 0, data: statici.interface.getSighash('test()')}
    return expect(
      wrappedExchange.atomicMatch(one, NULL_SIG, call, two, signature, call, ZERO_BYTES32)
    ).to.be.revertedWith('First order failed authorization')
  })

  it('does not match with invalid second order auth',async () => {
    const selector = statici.interface.getSighash('any(bytes,address[7],uint8[2],uint256[6],bytes,bytes)')
    const one = {registry: registry.address, maker: signers[6].address, staticTarget: statici.address, staticSelector: selector, staticExtradata: '0x', maximumFill: '1', listingTime: '0', expirationTime: '100000000000', salt: randomUint()}
    const two = {registry: registry.address, maker: signers[6].address, staticTarget: statici.address, staticSelector: selector, staticExtradata: '0x', maximumFill: '1', listingTime: '0', expirationTime: '100000000000', salt: randomUint()}
    
    let signature = await wrappedExchange.sign(one, signers[6])
    const call = {target: statici.address, howToCall: 0, data: statici.interface.getSighash('test()')}
    return expect(
      wrappedExchange.atomicMatch(one, signature, call, two, NULL_SIG, call, ZERO_BYTES32)
    ).to.be.revertedWith('Second order failed authorization')
  })

  it('does not match with invalid first order params',async () => {
    const selector = statici.interface.getSighash('any(bytes,address[7],uint8[2],uint256[6],bytes,bytes)')
    const one = {registry: registry.address, maker: signers[6].address, staticTarget: statici.address, staticSelector: selector, staticExtradata: '0x', maximumFill: '1', listingTime: '0', expirationTime: '100000000000', salt: randomUint()}
    const two = {registry: registry.address, maker: signers[6].address, staticTarget: statici.address, staticSelector: selector, staticExtradata: '0x', maximumFill: '1', listingTime: '0', expirationTime: '100000000000', salt: randomUint()}
    
    await exchange.connect(signers[6]).setOrderFill_(hashOrder(one), '10')
    let [oneSig,twoSig] = await Promise.all([wrappedExchange.sign(one, signers[6]),wrappedExchange.sign(two, signers[6])])
    const call = {target: statici.address, howToCall: 0, data: statici.interface.getSighash('test()')}
    return expect(
      wrappedExchange.atomicMatch(one, oneSig, call, two, twoSig, call, ZERO_BYTES32)
    ).to.be.revertedWith('First order has invalid parameters')
  })

  it('does not match with invalid second order params',async () => {
    const selector = statici.interface.getSighash('any(bytes,address[7],uint8[2],uint256[6],bytes,bytes)')
    const one = {registry: registry.address, maker: signers[6].address, staticTarget: statici.address, staticSelector: selector, staticExtradata: '0x', maximumFill: '1', listingTime: '0', expirationTime: '100000000000', salt: randomUint()}
    const two = {registry: registry.address, maker: signers[6].address, staticTarget: statici.address, staticSelector: selector, staticExtradata: '0x', maximumFill: '1', listingTime: '0', expirationTime: '100000000000', salt: randomUint()}
    
    await exchange.connect(signers[6]).setOrderFill_(hashOrder(two), '3')
    let [oneSig,twoSig] = await Promise.all([wrappedExchange.sign(one, signers[6]),wrappedExchange.sign(two, signers[6])])
    const call = {target: statici.address, howToCall: 0, data: statici.interface.getSighash('test()')}
    return expect(
      wrappedExchange.atomicMatch(one, oneSig, call, two, twoSig, call, ZERO_BYTES32)
    ).to.be.revertedWith('Second order has invalid parameters')
  })

  it('does not match with nonexistent first proxy',async () => {
    const selector = statici.interface.getSighash('any(bytes,address[7],uint8[2],uint256[6],bytes,bytes)')
    const one = {registry: registry.address, maker: signers[7].address, staticTarget: statici.address, staticSelector: selector, staticExtradata: '0x', maximumFill: '1', listingTime: '0', expirationTime: '100000000000', salt: randomUint()}
    const two = {registry: registry.address, maker: signers[6].address, staticTarget: statici.address, staticSelector: selector, staticExtradata: '0x', maximumFill: '1', listingTime: '0', expirationTime: '100000000000', salt: randomUint()}
    
    let [oneSig,twoSig] = await Promise.all([wrappedExchange.sign(one, signers[7]),wrappedExchange.sign(two, signers[7])])
    const call = {target: statici.address, howToCall: 0, data: statici.interface.getSighash('test()')}
    return expect(
      wrappedExchange.atomicMatch(one, oneSig, call, two, twoSig, call, ZERO_BYTES32)
    ).to.be.revertedWith('Second order failed authorization')
  })

  it('does not match with nonexistent second proxy',async () => {
    const selector = statici.interface.getSighash('any(bytes,address[7],uint8[2],uint256[6],bytes,bytes)')
    const one = {registry: registry.address, maker: signers[6].address, staticTarget: statici.address, staticSelector: selector, staticExtradata: '0x', maximumFill: '1', listingTime: '0', expirationTime: '100000000000', salt: randomUint()}
    const two = {registry: registry.address, maker: signers[7].address, staticTarget: statici.address, staticSelector: selector, staticExtradata: '0x', maximumFill: '1', listingTime: '0', expirationTime: '100000000000', salt: randomUint()}
    
    let [oneSig,twoSig] = await Promise.all([wrappedExchange.sign(one, signers[6]),wrappedExchange.sign(two, signers[6])])
    const call = {target: statici.address, howToCall: 0, data: statici.interface.getSighash('test()')}
    return expect(
      wrappedExchange.atomicMatch(one, oneSig, call, two, twoSig, call, ZERO_BYTES32)
    ).to.be.revertedWith('Second order failed authorization')
  })

  it('should not match with nonexistent target',async () => {
    const selector = statici.interface.getSighash('any(bytes,address[7],uint8[2],uint256[6],bytes,bytes)')
    const one = {registry: registry.address, maker: signers[6].address, staticTarget: statici.address, staticSelector: selector, staticExtradata: '0x', maximumFill: '1', listingTime: '0', expirationTime: '100000000000', salt: randomUint()}
    const two = {registry: registry.address, maker: signers[6].address, staticTarget: statici.address, staticSelector: selector, staticExtradata: '0x', maximumFill: '1', listingTime: '0', expirationTime: '100000000000', salt: randomUint()}
    
    let [oneSig,twoSig] = await Promise.all([wrappedExchange.sign(one, signers[6]),wrappedExchange.sign(two, signers[6])])
    const call = {target: signers[7].address, howToCall: 0, data: statici.interface.getSighash('test()')}
    return expect(
      wrappedExchange.atomicMatch(one, oneSig, call, two, twoSig, call, ZERO_BYTES32)
    ).to.be.revertedWith('Call target does not exist')
  })

  it('should allow value transfer',async () => {
    await registry.connect(signers[6]).registerProxy()
    const selector = statici.interface.getSighash('any(bytes,address[7],uint8[2],uint256[6],bytes,bytes)')
    const one = {registry: registry.address, maker: signers[6].address, staticTarget: statici.address, staticSelector: selector, staticExtradata: '0x', maximumFill: '1', listingTime: '0', expirationTime: '100000000000', salt: randomUint()}
    const two = {registry: registry.address, maker: signers[6].address, staticTarget: statici.address, staticSelector: selector, staticExtradata: '0x', maximumFill: '1', listingTime: '0', expirationTime: '100000000000', salt: randomUint()}
    
    let oneSig = await wrappedExchange.sign(one, signers[6]);
    let twoSig = await wrappedExchange.sign(two, signers[6]);
    const call = {target: statici.address, howToCall: 0, data: statici.interface.getSighash('test()')}
    assert.isOk(await wrappedExchange.atomicMatchWith(one, oneSig, call, two, twoSig, call, ZERO_BYTES32, {from: signers[6],value: ethers.BigNumber.from(200)}))
  })

  //This test is ommited due to the orginal personalSign() function in aux.js from wvyern not being an actual personal signature
  /*it('matches orders signed with personal_sign',async () => {
    const selector = statici.interface.getSighash('any(bytes,address[7],uint8[2],uint256[6],bytes,bytes)')
    const one = {registry: registry.address, maker: signers[0].address, staticTarget: statici.address, staticSelector: selector, staticExtradata: '0x', maximumFill: '1', listingTime: '0', expirationTime: '100000000000', salt: '0'}
    const two = {registry: registry.address, maker: signers[6].address, staticTarget: statici.address, staticSelector: selector, staticExtradata: '0x', maximumFill: '1', listingTime: '0', expirationTime: '100000000000', salt: '1'}
    const call = {target: statici.address, howToCall: 0, data: statici.interface.getSighash('test()')}
    let sigOne = await wrappedExchange.personalSign(one,signers[0].address)
    let sigTwo = await exchange.personalSign(two,accounts[6])
    assert.isOk(await exchange.atomicMatchWith(one, sigOne, call, two, sigTwo, call, ZERO_BYTES32, {from: accounts[5]}))
  })*/
})
