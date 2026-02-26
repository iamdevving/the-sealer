// src/lib/eas.ts
// Fetches attestation data from EAS GraphQL by UID
// Base Sepolia endpoint — swap to mainnet when ready

const EAS_GRAPHQL = 'https://base-sepolia.easscan.org/graphql';

export interface AttestationData {
  uid: string;
  txHash: string;
  achievement: string;
  attester: string;
  recipient: string;
  time: number;
}

export async function fetchAttestation(uid: string): Promise<AttestationData | null> {
  const query = `
    query GetAttestation($uid: String!) {
      attestation(where: { id: $uid }) {
        id
        txid
        attester
        recipient
        time
        decodedDataJson
      }
    }
  `;

  try {
    const res = await fetch(EAS_GRAPHQL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables: { uid } }),
      next: { revalidate: 60 }, // cache 60s
    });

    const json = await res.json();
    const a = json?.data?.attestation;
    if (!a) return null;

    // Decode the achievement string from decodedDataJson
    let achievement = 'Verified Statement';
    try {
      const decoded = JSON.parse(a.decodedDataJson);
      const field = decoded.find((f: any) => f.name === 'achievement');
      if (field?.value?.value) achievement = field.value.value;
    } catch {}

    return {
      uid:         a.id,
      txHash:      a.txid,
      achievement,
      attester:    a.attester,
      recipient:   a.recipient,
      time:        Number(a.time),
    };
  } catch (err) {
    console.error('[Sealer] EAS fetch error:', err);
    return null;
  }
}
