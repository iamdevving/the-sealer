// src/app/sid/page.tsx
import { Suspense } from 'react';
import SIDPage from './SIDPage';

export default function Page() {
  return (
    <Suspense>
      <SIDPage />
    </Suspense>
  );
}