'use client';
// src/app/mirror/page.tsx
import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { WagmiProviders } from '@/components/WagmiProviders';
import { SolanaProviders } from '@/components/SolanaProviders';
import MirrorInteractivePage from './MirrorInteractivePage';
import MirrorPage from './MirrorPage';

function MirrorRouter() {
  const searchParams  = useSearchParams();
  const mirrorTokenId = searchParams.get('mirrorTokenId');
  const txHash        = searchParams.get('txHash');

  if (mirrorTokenId || txHash) {
    return <MirrorPage />;
  }

  return <MirrorInteractivePage />;
}

export default function Page() {
  return (
    <WagmiProviders>
      <SolanaProviders>
        <Suspense>
          <MirrorRouter />
        </Suspense>
      </SolanaProviders>
    </WagmiProviders>
  );
}