// src/lib/wagmi.ts
import { createConfig, http } from 'wagmi';
import { base } from 'wagmi/chains';
import { injected, walletConnect } from 'wagmi/connectors';

export const wagmiConfig = createConfig({
  chains: [base],
  connectors: [
    injected(),
    walletConnect({
      projectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || 'demo',
    }),
  ],
  transports: {
    [base.id]: http(process.env.ALCHEMY_RPC_URL || 'https://mainnet.base.org'),
  },
});