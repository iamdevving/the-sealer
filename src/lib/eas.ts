// src/lib/eas.ts
const EAS_GRAPHQL = 'https://base.easscan.org/graphql';

export interface AttestationData {
  uid:       string;
  txHash:    string;
  statement: string;
  attester:  string;
  recipient: string;
  time:      number;
  // Achievement schema fields (present when attestation is an achievement)
  claimType?:  string;
  difficulty?: number;
  daysEarly?:  number | null;
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

function getField(decoded: any[], name: string): any {
  return decoded.find((f: any) => f.name === name)?.value?.value ?? undefined;
}

function parseAttestation(a: any): AttestationData | null {
  if (!a) return null;

  let statement  = 'Verified Statement';
  let claimType: string | undefined;
  let difficulty: number | undefined;
  let daysEarly:  number | null | undefined;

  try {
    const decoded = JSON.parse(a.decodedDataJson);

    const statField = decoded.find((f: any) => f.name === 'statement');
    if (statField?.value?.value) statement = statField.value.value;

    claimType = getField(decoded, 'claimType');

    const rawDiff = getField(decoded, 'difficulty');
    if (rawDiff != null) difficulty = Number(rawDiff);

    const rawDaysEarly = getField(decoded, 'daysEarly');
    if (rawDaysEarly != null) daysEarly = Number(rawDaysEarly);
  } catch {}

  return {
    uid:       a.id,
    txHash:    a.txid,
    statement,
    attester:  a.attester,
    recipient: a.recipient,
    time:      Number(a.time),
    claimType,
    difficulty,
    daysEarly,
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