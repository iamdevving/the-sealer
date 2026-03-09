// src/app/mirror/page.tsx
import { Suspense } from 'react';
import MirrorPage from './MirrorPage';

export default function Page() {
  return (
    <Suspense>
      <MirrorPage />
    </Suspense>
  );
}
