// src/app/api/mirror/nfts/route.ts
import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

const ALCHEMY_KEY = process.env.ALCHEMY_API_KEY || process.env.ALCHEMY_RPC_URL?.split('/').pop() || '';
const HELIUS_KEY  = process.env.HELIUS_API_KEY || '';

export interface NFTItem {
  chain:       'base' | 'solana';
  contract:    string;
  tokenId:     string;
  name:        string;
  imageUrl:    string;
  collectionName?: string;
}

async function fetchBaseNFTs(wallet: string): Promise<NFTItem[]> {
  if (!ALCHEMY_KEY) return [];
  try {
    const url = `https://base-mainnet.g.alchemy.com/nft/v3/${ALCHEMY_KEY}/getNFTsForOwner?owner=${wallet}&withMetadata=true&pageSize=50`;
    const res  = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.ownedNfts || []).map((nft: any) => {
      const img = nft.image?.cachedUrl || nft.image?.originalUrl || nft.image?.pngUrl || '';
      return {
        chain:           'base' as const,
        contract:        nft.contract?.address || '',
        tokenId:         nft.tokenId || '',
        name:            nft.name || `#${nft.tokenId}`,
        imageUrl:        img,
        collectionName:  nft.contract?.name || '',
      };
    }).filter((n: NFTItem) => n.contract && n.tokenId);
  } catch { return []; }
}

async function fetchSolanaNFTs(wallet: string): Promise<NFTItem[]> {
  if (!HELIUS_KEY) return [];
  try {
    const url = `https://mainnet.helius-rpc.com/?api-key=${HELIUS_KEY}`;
    const body = {
      jsonrpc: '2.0', id: 'get-assets', method: 'getAssetsByOwner',
      params: {
        ownerAddress: wallet,
        page: 1, limit: 50,
        displayOptions: { showFungible: false, showNativeBalance: false },
      },
    };
    const res  = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(8000) });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.result?.items || [])
      .filter((a: any) => a.interface === 'V1_NFT' || a.interface === 'ProgrammableNFT' || a.interface === 'MplCoreAsset')
      .map((a: any) => {
        const img = a.content?.links?.image || a.content?.json_uri || '';
        return {
          chain:          'solana' as const,
          contract:       a.grouping?.find((g: any) => g.group_key === 'collection')?.group_value || a.id,
          tokenId:        a.id,
          name:           a.content?.metadata?.name || a.id.slice(0, 8) + '...',
          imageUrl:       img,
          collectionName: a.content?.metadata?.symbol || '',
        };
      }).filter((n: NFTItem) => n.tokenId);
  } catch { return []; }
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const baseWallet   = searchParams.get('baseWallet')   || '';
  const solanaWallet = searchParams.get('solanaWallet') || '';
  const chain        = searchParams.get('chain') || 'all';

  if (!baseWallet && !solanaWallet) {
    return NextResponse.json({ error: 'baseWallet or solanaWallet required' }, { status: 400 });
  }

  const results: NFTItem[] = [];

  if ((chain === 'all' || chain === 'base') && baseWallet) {
    const baseNFTs = await fetchBaseNFTs(baseWallet);
    results.push(...baseNFTs);
  }

  if ((chain === 'all' || chain === 'solana') && solanaWallet) {
    const solanaNFTs = await fetchSolanaNFTs(solanaWallet);
    results.push(...solanaNFTs);
  }

  return NextResponse.json({ nfts: results, total: results.length });
}