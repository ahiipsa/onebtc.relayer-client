import { IServices } from '../../init';
const axios = require('axios');
const bitcoin = require('bitcoinjs-lib');
const BN = require('bn.js');

import logger from '../../../logger';
import { getNetworkFee, getTxsByAddress, searchTxByHex } from '../../../bitcoin/rpc';
import { IssueRequest } from '../../common';
import { getBech32FromHex } from '../../../bitcoin/helpers';
import { Buffer } from 'buffer';
import { derivate } from './derivate';
import { getActualOutputs } from './helpers';
import { sleep } from '../../../utils';
const log = logger.module('WalletBTC:main');

export interface IWalletBTC {
  services: IServices;
  vaultId: string;
  btcPrivateKey: string;
}

interface IFreeOutput {
  id: any; // secretKey
  value: Number;
  hex: string;
  hash: string;
  index: number;
  bech32Address: string;
}

export class WalletBTC {
  services: IServices;
  vaultId: string;

  constructor(params: IWalletBTC) {
    this.services = params.services;
    this.vaultId = params.vaultId;
  }

  getAmountFromTx = (txObj: any, address: string) => {
    const output = txObj.outputs.find(out => out.address === address);
    return output ? output.value : 0;
  };

  getBalances = async () => {
    const balances = {};

    const outs = await this.getFreeOutputs(0, true);
    outs.forEach(o => (balances[o.bech32Address] = (balances[o.bech32Address] || 0) + o.value));

    return balances;
  };

  getFreeOutputs = async (amount: number, getMax = false): Promise<IFreeOutput[]> => {
    const issues = await this.services.issues.getData({
      page: 0,
      size: 100000,
      filter: {
        vault: this.vaultId,
        // status: '2',
      },
    });

    const freeOutputs: IFreeOutput[] = [];
    let totalAmount = 0;
    let i = 0;

    while ((getMax || totalAmount < amount) && i < issues.content.length) {
      const issue: IssueRequest = issues.content[i];

      const bech32Address = bitcoin.address.toBech32(
        Buffer.from(issue.btcAddress.slice(2), 'hex'),
        0,
        'tb'
      );
      const txs = await getTxsByAddress(bech32Address);
      let outputs = getActualOutputs(txs, bech32Address);

      outputs.forEach(out => {
        if (getMax || totalAmount < amount) {
          totalAmount += Number(out.value);
          freeOutputs.push({ ...out, id: issue.id, bech32Address });
        }
      });

      i++;
    }

    if (totalAmount < amount) {
      throw new Error('Vault BTC Balance is too low');
    }

    return freeOutputs;
  };

  sendTx = async (params: { amount: string; to: string; id: string }) => {
    const psbt = new bitcoin.Psbt({
      network: bitcoin.networks.testnet,
    });

    psbt.setVersion(2); // These are defaults. This line is not needed.
    psbt.setLocktime(0); // These are defaults. This line is not needed.

    const fee = await getNetworkFee();

    const freeOutputs = await this.getFreeOutputs(Number(params.amount) + fee);

    freeOutputs.forEach(output => {
      const utxo = Buffer.from(output.hex, 'hex');

      psbt.addInput({
        hash: output.hash,
        index: output.index,
        nonWitnessUtxo: utxo,
      });
    });

    const toBech32Address = bitcoin.address.toBech32(
      Buffer.from(params.to.slice(2), 'hex'),
      0,
      'tb'
    );

    psbt.addOutput({
      address: toBech32Address,
      value: Number(params.amount),
    });

    const leftAmount =
      freeOutputs.reduce((acc, out) => acc + Number(out.value), 0) - Number(params.amount);

    psbt.addOutput({
      address: freeOutputs[0].bech32Address,
      value: leftAmount - fee,
    });

    const embed = bitcoin.payments.embed({ data: [new BN(params.id).toBuffer()] });
    psbt.addOutput({
      script: embed.output,
      value: 0,
    });

    freeOutputs.forEach((output, idx) => {
      const vaultEcPair = derivate(process.env.BTC_VAULT_PRIVATE_KEY, output.id);

      psbt.signInput(idx, vaultEcPair);
      psbt.validateSignaturesOfInput(idx);
    });

    psbt.finalizeAllInputs();

    const transactionHex = psbt.extractTransaction().toHex();

    const res = await axios.post(`${process.env.BTC_NODE_URL}/broadcast`, {
      tx: transactionHex,
    });

    if (res.data.success !== true) {
      throw new Error('Error to send broadcast');
    }

    await sleep(2000);

    const tx = await searchTxByHex({
      bech32Address: freeOutputs[0].bech32Address,
      txHex: transactionHex,
    });

    if (!tx) {
      return {
        status: false,
        transactionHash: '',
      };
    }

    return {
      status: true,
      transactionHash: tx.hash,
      tx,
    };
  };
}