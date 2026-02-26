import { Suspense } from 'react';
import CardPage from './CardPage';

export default function Page() {
  return (
    <Suspense fallback={null}>
      <CardPage />
    </Suspense>
  );
}
