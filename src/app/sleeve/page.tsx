// src/app/sleeve/page.tsx
import { Suspense } from 'react';
import SleevePage from './SleevePage';

export default function Page() {
  return (
    <Suspense>
      <SleevePage />
    </Suspense>
  );
}
