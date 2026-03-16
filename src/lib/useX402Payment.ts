// src/lib/useX402Payment.ts
// Browser-side x402 payment hook for Mirror minting
// Sends USDC on Base (via wagmi) or USDC on Solana (via Phantom)
import { useCallback } from 'react';
import { useWalletClient, usePublicClient } from 'wagmi';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { parseUnits, encodeFunctionData } from 'viem';
import {
  PublicKey,
  Transaction,
  SystemProgram,
} from '@solana/web3.js';
import {
  getAssociatedTokenAddress,
  createTransferInstruction,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from '@solana/spl-token';

// Base USDC
const BASE_USDC_CONTRACT  = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as const;
const BASE_RECIPIENT      = '0x4386606286eEA12150386f0CFc55959F30de00D1' as const;

// Solana USDC
const SOLANA_USDC_MINT    = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const SOLANA_RECIPIENT    = '6JudwBzstGy61GeVaZye55awss3Uek4Sp49bGJE32dPj';

const ERC20_TRANSFER_ABI = [{
  name:    'transfer',
  type:    'function',
  inputs:  [{ name: 'to', type: 'address' }, { name: 'amount', type: 'uint256' }],
  outputs: [{ name: '', type: 'bool' }],
}] as const;

export type PaymentChain = 'base' | 'solana';

export interface PaymentResult {
  txHash:       string;
  paymentChain: PaymentChain;
}

export function useX402Payment() {
  const { data: walletClient }      = useWalletClient();
  const publicClient                = usePublicClient();
  const { publicKey, sendTransaction: solSendTransaction } = useWallet();
  const { connection }              = useConnection();

  const payOnBase = useCallback(async (amountUSDC: string): Promise<string> => {
    if (!walletClient) throw new Error('EVM wallet not connected');
    const amount = parseUnits(amountUSDC, 6); // USDC has 6 decimals

    const hash = await walletClient.writeContract({
      address:      BASE_USDC_CONTRACT,
      abi:          ERC20_TRANSFER_ABI,
      functionName: 'transfer',
      args:         [BASE_RECIPIENT, amount],
    });

    // Wait for confirmation
    await publicClient?.waitForTransactionReceipt({ hash });
    return hash;
  }, [walletClient, publicClient]);

  const payOnSolana = useCallback(async (amountUSDC: string): Promise<string> => {
    if (!publicKey) throw new Error('Solana wallet not connected');

    const usdcMint      = new PublicKey(SOLANA_USDC_MINT);
    const recipientKey  = new PublicKey(SOLANA_RECIPIENT);
    const amount        = Math.round(parseFloat(amountUSDC) * 1_000_000); // 6 decimals

    // Get token accounts
    const senderATA    = await getAssociatedTokenAddress(usdcMint, publicKey);
    const recipientATA = await getAssociatedTokenAddress(usdcMint, recipientKey);

    const tx = new Transaction().add(
      createTransferInstruction(
        senderATA,
        recipientATA,
        publicKey,
        amount,
        [],
        TOKEN_PROGRAM_ID,
      )
    );

    const { blockhash } = await connection.getLatestBlockhash();
    tx.recentBlockhash  = blockhash;
    tx.feePayer         = publicKey;

    const signature = await solSendTransaction(tx, connection);

    // Wait for confirmation with longer timeout — if it times out we still
    // proceed since the tx was submitted and will likely confirm
    try {
      const { blockhash: latestBlockhash, lastValidBlockHeight } =
        await connection.getLatestBlockhash('confirmed');
      await connection.confirmTransaction(
        { signature, blockhash: latestBlockhash, lastValidBlockHeight },
        'confirmed',
      );
    } catch (confirmErr: any) {
      // Timeout is non-fatal — tx was submitted, signature is valid
      console.warn('[x402] Solana confirmation timeout (non-fatal):', confirmErr?.message);
      // Brief extra wait then continue
      await new Promise(r => setTimeout(r, 3000));
    }
    return signature;
  }, [publicKey, solSendTransaction, connection]);

  const pay = useCallback(async (
    amountUSDC: string,
    preferredChain: PaymentChain = 'base',
  ): Promise<PaymentResult> => {
    if (preferredChain === 'solana' && publicKey) {
      const txHash = await payOnSolana(amountUSDC);
      return { txHash, paymentChain: 'solana' };
    }
    if (walletClient) {
      const txHash = await payOnBase(amountUSDC);
      return { txHash, paymentChain: 'base' };
    }
    throw new Error('No wallet connected for payment');
  }, [payOnBase, payOnSolana, walletClient, publicKey]);

  return { pay, payOnBase, payOnSolana };
}