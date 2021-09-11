// simplified from https://github.com/ethereum/EIPs/blob/master/assets/eip-712/Example.js

import * as ethUtil from 'ethereumjs-util';
import * as abi from 'ethereumjs-abi';

function encodeType (name, fields) {
  let result = `${name}(${fields.map(({ name, type }) => `${type} ${name}`).join(',')})`
  return result
}

function typeHash (name, fields) {
  return ethUtil.sha3(encodeType(name, fields))
}

function encodeData (name, fields, data) {
  let encTypes = []
  let encValues = []

  // Add typehash
  encTypes.push('bytes32')
  encValues.push(typeHash(name, fields))

  // Add field contents
  for (let field of fields) {
    let value = data[field.name]
    if (field.type === 'string' || field.type === 'bytes') {
      encTypes.push('bytes32')
      value = ethUtil.sha3(value)
      encValues.push(value)
    } else {
      encTypes.push(field.type)
      encValues.push(value)
    }
  }

  return abi.rawEncode(encTypes, encValues)
}

export function structHash (name, fields, data) {
  return ethUtil.sha3(encodeData(name, fields, data))
}

export const eip712Domain = {
  name: 'EIP712Domain',
  fields: [
    { name: 'name', type: 'string' },
    { name: 'version', type: 'string' },
    { name: 'chainId', type: 'uint256' },
    { name: 'verifyingContract', type: 'address' }
  ]
}

export function signHash (typedData) {
  return ethUtil.sha3(
    Buffer.concat([
      Buffer.from('1901', 'hex'),
      structHash(eip712Domain.name, eip712Domain.fields, typedData.domain),
      structHash(typedData.name, typedData.fields, typedData.data)
    ])
  )
}
