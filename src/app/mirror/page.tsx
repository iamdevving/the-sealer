'use client';
// src/app/mirror/page.tsx
import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { WagmiProviders } from '@/components/WagmiProviders';
import MirrorInteractivePage from './MirrorInteractivePage';
import MirrorPage from './MirrorPage';

function MirrorRouter() {
  const searchParams = useSearchParams();
  const mirrorTokenId = searchParams.get('mirrorTokenId');
  const txHash        = searchParams.get('txHash');

  // If we have a mirrorTokenId or txHash, show the display page
  if (mirrorTokenId || txHash) {
    return <MirrorPage />;
  }

  // Otherwise show the interactive mint flow
  return <MirrorInteractivePage />;
}

export default function Page() {
  return (
    <WagmiProviders>
      <Suspense>
        <MirrorRouter />
      </Suspense>
    </WagmiProviders>
  );
}