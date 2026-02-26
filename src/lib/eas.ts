// src/lib/eas.ts
const EAS_GRAPHQL = 'https://base-sepolia.easscan.org/graphql';

export interface AttestationData {
  uid: string;
  txHash: string;
  achievement: string;
  attester: string;
  recipient: string;
  time: number;
}

async function queryEAS(query: string, variables: Record<string, string>) {
  const res = await fetch(EAS_GRAPHQL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
    next: { revalidate: 60 },
  });
  return res.json();
}

function parseAttestation(a: any): AttestationData | null {
  if (!a) return null;
  let achievement = 'Verified Statement';
  try {
    const decoded = JSON.parse(a.decodedDataJson);
    const field = decoded.find((f: any) => f.name === 'achievement');
    if (field?.value?.value) achievement = field.value.value;
  } catch {}
  return {
    uid:       a.id,
    txHash:    a.txid,
    achievement,
    attester:  a.attester,
    recipient: a.recipient,
    time:      Number(a.time),
  };
}

// Fetch by attestation UID (0x... from EAS, returned by issueSealAttestation)
export async function fetchAttestation(uid: string): Promise<AttestationData | null> {
  try {
    const json = await queryEAS(`
      query Get($id: String!) {
        attestation(where: { id: $id }) {
          id txid attester recipient time decodedDataJson
        }
      }
    `, { id: uid });
    return parseAttestation(json?.data?.attestation);
  } catch (err) {
    console.error('[Sealer] EAS fetch by UID error:', err);
    return null;
  }
}

// Fetch by TX hash (fallback — finds the attestation created in that TX)
export async function fetchAttestationByTx(txHash: string): Promise<AttestationData | null> {
  try {
    const json = await queryEAS(`
      query GetByTx($txid: String!) {
        attestations(where: { txid: { equals: $txid } }, take: 1) {
          id txid attester recipient time decodedDataJson
        }
      }
    `, { txid: txHash });
    const list = json?.data?.attestations;
    return parseAttestation(list?.[0]);
  } catch (err) {
    console.error('[Sealer] EAS fetch by TX error:', err);
    return null;
  }
}
