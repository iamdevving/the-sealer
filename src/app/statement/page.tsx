// src/app/statement/page.tsx
import { Suspense } from 'react';
import StatementPage from './StatementPage';

export default function Page() {
  return (
    <Suspense fallback={null}>
      <StatementPage />
    </Suspense>
  );
}