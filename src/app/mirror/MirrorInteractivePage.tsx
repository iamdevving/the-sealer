'use client';
// src/app/mirror/MirrorInteractivePage.tsx
import { useState, useCallback } from 'react';
import { useAccount, useConnect, useDisconnect } from 'wagmi';

type Step = 'connect' | 'browse' | 'configure' | 'minting' | 'done';

interface NFTItem {
  chain:          'base' | 'solana';
  contract:       string;
  tokenId:        string;
  name:           string;
  imageUrl:       string;
  collectionName?: string;
}

function truncateAddr(a: string) {
  if (!a) return '';
  return a.slice(0, 6) + '···' + a.slice(-4);
}

const accent   = '#3b82f6';
const bg       = '#0d1117';
const hdrBg    = '#0a0f1e';
const ink      = '#c8d8f0';
const inkDim   = '#5a7090';
const faint    = '#1e2d4a';

export default function MirrorInteractivePage() {
  const { address, isConnected } = useAccount();
  const { connect, connectors }  = useConnect();
  const { disconnect }           = useDisconnect();

  const [step,           setStep]           = useState<Step>('connect');
  const [nfts,           setNfts]           = useState<NFTItem[]>([]);
  const [loading,        setLoading]        = useState(false);
  const [selectedNFT,    setSelectedNFT]    = useState<NFTItem | null>(null);
  const [solanaWallet,   setSolanaWallet]   = useState('');
  const [targetWallet,   setTargetWallet]   = useState('');
  const [targetChain,    setTargetChain]    = useState<'Base'>('Base');
  const [error,          setError]          = useState('');
  const [mintResult,     setMintResult]     = useState<any>(null);
  const [nftFilter,      setNftFilter]      = useState<'all' | 'base' | 'solana'>('all');

  // Fetch NFTs for connected wallet
  const fetchNFTs = useCallback(async (baseAddr: string, solAddr: string) => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (baseAddr) params.set('baseWallet', baseAddr);
      if (solAddr)  params.set('solanaWallet', solAddr);
      const res  = await fetch(`/api/mirror/nfts?${params}`);
      const data = await res.json();
      setNfts(data.nfts || []);
      setStep('browse');
    } catch { setError('Failed to load NFTs'); }
    finally  { setLoading(false); }
  }, []);

  async function handleMint() {
    if (!selectedNFT || !address) return;
    setStep('minting');
    setError('');
    try {
      const recipient = targetWallet || address;
      const res  = await fetch('/api/mirror/mint', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          originalChain:    selectedNFT.chain,
          originalContract: selectedNFT.contract,
          originalTokenId:  selectedNFT.tokenId,
          ownerWallet:      address,
          recipientWallet:  recipient,
          targetChain,
          nftName:          selectedNFT.name,
          imageUrl:         selectedNFT.imageUrl,
          paymentChain:     'Base',
        }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Mint failed'); setStep('configure'); return; }
      setMintResult(data);
      setStep('done');
    } catch (e: any) { setError(String(e)); setStep('configure'); }
  }

  const filteredNFTs = nfts.filter(n => nftFilter === 'all' || n.chain === nftFilter);

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        body {
          background: #060a12; min-height: 100vh;
          font-family: 'Space Mono', monospace; color: ${ink};
          padding: 24px;
        }
        .wrap { max-width: 860px; margin: 0 auto; display: flex; flex-direction: column; gap: 20px; }
        .card {
          background: ${hdrBg}; border-radius: 12px;
          border: 1px solid ${faint}; overflow: hidden;
        }
        .card-header {
          padding: 16px 24px; border-bottom: 0.8px solid ${faint};
          display: flex; align-items: center; justify-content: space-between;
        }
        .card-title { font-size: 11px; color: ${ink}; letter-spacing: 2px; }
        .card-sub   { font-size: 7px; color: ${inkDim}; letter-spacing: 1px; margin-top: 2px; }
        .card-body  { padding: 24px; }
        .accent-bar { height: 2.5px; background: ${accent}; opacity: 0.9; }

        /* Wallet connect */
        .wallet-area { display: flex; flex-direction: column; align-items: center; gap: 20px; padding: 40px 24px; text-align: center; }
        .wallet-title { font-family: Georgia, serif; font-size: 22px; color: ${ink}; letter-spacing: 2px; }
        .wallet-sub { font-size: 9px; color: ${inkDim}; letter-spacing: 1px; max-width: 420px; line-height: 1.7; }
        .connector-list { display: flex; flex-direction: column; gap: 10px; width: 100%; max-width: 320px; }
        .connector-btn {
          padding: 12px 20px; border-radius: 8px; font-size: 9px; font-weight: 700;
          letter-spacing: 1.5px; cursor: pointer; border: 0.8px solid ${accent};
          background: transparent; color: ${accent}; font-family: monospace;
          transition: all .15s; text-align: left;
        }
        .connector-btn:hover { background: ${accent}18; }

        /* Connected bar */
        .connected-bar {
          display: flex; align-items: center; gap: 12px;
          padding: 10px 20px; background: ${faint}22;
          border-bottom: 0.8px solid ${faint};
        }
        .connected-dot { width: 6px; height: 6px; border-radius: 50%; background: #22c55e; }
        .connected-addr { font-size: 9px; color: ${ink}; letter-spacing: 0.5px; }
        .disconnect-btn {
          margin-left: auto; padding: 4px 12px; border-radius: 4px;
          font-size: 7px; letter-spacing: 1px; cursor: pointer;
          border: 0.8px solid ${faint}; background: transparent; color: ${inkDim};
          font-family: monospace; transition: all .15s;
        }
        .disconnect-btn:hover { border-color: #ef4444; color: #ef4444; }

        /* Solana wallet input */
        .solana-input-row { display: flex; gap: 10px; align-items: center; }
        .sol-input {
          flex: 1; background: ${faint}22; border: 0.8px solid ${faint};
          border-radius: 6px; padding: 8px 12px;
          font-family: monospace; font-size: 9px; color: ${ink}; outline: none;
        }
        .sol-input:focus { border-color: ${accent}; }
        .sol-input::placeholder { color: ${inkDim}; }
        .fetch-btn {
          padding: 8px 16px; border-radius: 6px; font-size: 8px; font-weight: 700;
          letter-spacing: 1px; cursor: pointer; border: 0.8px solid ${accent};
          background: ${accent}; color: #fff; font-family: monospace;
          transition: all .15s; white-space: nowrap;
        }
        .fetch-btn:disabled { opacity: 0.4; cursor: default; }

        /* NFT grid */
        .filter-row { display: flex; gap: 8px; margin-bottom: 16px; }
        .filter-pill {
          padding: 4px 12px; border-radius: 12px; font-size: 7px; letter-spacing: 1px;
          cursor: pointer; border: 0.8px solid ${faint};
          background: transparent; color: ${inkDim}; font-family: monospace;
          transition: all .15s;
        }
        .filter-pill.active { border-color: ${accent}; color: ${accent}; background: ${accent}18; }
        .nft-grid {
          display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 12px;
        }
        .nft-item {
          border-radius: 8px; overflow: hidden; cursor: pointer;
          border: 1.5px solid ${faint}; transition: all .15s; background: ${faint}22;
        }
        .nft-item:hover { border-color: ${accent}88; transform: translateY(-1px); }
        .nft-item.selected { border-color: ${accent}; box-shadow: 0 0 12px ${accent}44; }
        .nft-img { width: 100%; aspect-ratio: 1; object-fit: cover; display: block; background: ${faint}; }
        .nft-img-placeholder { width: 100%; aspect-ratio: 1; background: ${faint}; display: flex; align-items: center; justify-content: center; font-size: 8px; color: ${inkDim}; }
        .nft-info { padding: 8px; }
        .nft-name { font-size: 8px; color: ${ink}; letter-spacing: 0.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .nft-chain { font-size: 6.5px; color: ${inkDim}; letter-spacing: 0.5px; margin-top: 2px; }
        .nft-empty { padding: 40px; text-align: center; font-size: 9px; color: ${inkDim}; letter-spacing: 1px; }

        /* Configure */
        .config-section { display: flex; gap: 24px; }
        .config-preview { flex-shrink: 0; }
        .config-preview-card {
          width: 180px; border-radius: 10px; overflow: hidden;
          background: linear-gradient(160deg, rgba(240,244,255,0.92) 0%, rgba(221,228,248,0.94) 100%);
          border: 1px solid rgba(180,195,230,0.7);
          box-shadow: 0 4px 16px rgba(60,80,140,0.18);
        }
        .config-preview-img { width: 100%; aspect-ratio: 1; object-fit: cover; display: block; }
        .config-preview-name { padding: 8px 10px; font-size: 9px; font-weight: 700; color: rgba(20,40,100,0.9); letter-spacing: 0.2px; }
        .config-fields { flex: 1; display: flex; flex-direction: column; gap: 16px; }
        .field-label { font-size: 6.5px; color: ${inkDim}; letter-spacing: 1.5px; margin-bottom: 6px; }
        .field-input {
          width: 100%; background: ${faint}22; border: 0.8px solid ${faint};
          border-radius: 6px; padding: 8px 12px;
          font-family: monospace; font-size: 9px; color: ${ink}; outline: none;
        }
        .field-input:focus { border-color: ${accent}; }
        .field-input::placeholder { color: ${inkDim}; }
        .chain-pills { display: flex; gap: 8px; }
        .chain-pill {
          padding: 6px 14px; border-radius: 6px; font-size: 8px; letter-spacing: 1px;
          cursor: pointer; border: 0.8px solid ${faint};
          background: transparent; color: ${inkDim}; font-family: monospace;
          transition: all .15s;
        }
        .chain-pill.active { border-color: ${accent}; color: ${accent}; background: ${accent}18; }

        /* Action buttons */
        .btn-row { display: flex; gap: 10px; margin-top: 8px; }
        .btn {
          padding: 11px 20px; border-radius: 8px; font-size: 9px; font-weight: 700;
          letter-spacing: 1.5px; cursor: pointer; border: 0.8px solid ${faint};
          background: transparent; color: ${inkDim}; font-family: monospace;
          transition: all .15s;
        }
        .btn:hover { border-color: ${accent}88; color: ${ink}; }
        .btn-primary { background: ${accent}; border-color: ${accent}; color: #fff; }
        .btn-primary:hover { box-shadow: 0 0 20px ${accent}66; transform: translateY(-1px); }
        .btn-primary:disabled { opacity: 0.4; cursor: default; transform: none; box-shadow: none; }

        /* Done */
        .done-area { display: flex; flex-direction: column; align-items: center; gap: 20px; padding: 40px 24px; text-align: center; }
        .done-title { font-family: Georgia, serif; font-size: 20px; color: ${ink}; }
        .done-sub { font-size: 9px; color: ${inkDim}; letter-spacing: 1px; max-width: 400px; line-height: 1.7; }
        .result-box { background: ${faint}22; border: 0.8px solid ${faint}; border-radius: 8px; padding: 16px; width: 100%; max-width: 420px; text-align: left; }
        .result-row { display: flex; justify-content: space-between; align-items: center; padding: 6px 0; border-bottom: 0.5px solid ${faint}33; }
        .result-row:last-child { border-bottom: none; }
        .result-key { font-size: 7px; color: ${inkDim}; letter-spacing: 1px; }
        .result-val { font-size: 8px; color: ${ink}; letter-spacing: 0.5px; }

        /* Error */
        .error-msg { padding: 10px 16px; background: #ef444422; border: 0.8px solid #ef444440; border-radius: 6px; font-size: 8px; color: #ef4444; letter-spacing: 0.5px; }

        /* Loading */
        .loading-pulse { font-size: 9px; color: ${inkDim}; letter-spacing: 1px; animation: pulse 1.5s infinite; }
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }

        @media (max-width: 600px) {
          .config-section { flex-direction: column; }
          .nft-grid { grid-template-columns: repeat(2, 1fr); }
        }
      `}</style>

      <div className="wrap">
        {/* Header */}
        <div className="card">
          <div className="accent-bar"/>
          <div className="card-header">
            <div>
              <div className="card-title">MIRROR AN NFT</div>
              <div className="card-sub">WRAP ANY NFT IN A SEALER MIRROR · CROSS-CHAIN</div>
            </div>
            {isConnected && (
              <div style={{display:'flex', alignItems:'center', gap:8}}>
                <div className="connected-dot"/>
                <span style={{fontSize:9, color:ink}}>{truncateAddr(address || '')}</span>
                <button className="disconnect-btn" onClick={() => { disconnect(); setStep('connect'); setNfts([]); }}>
                  DISCONNECT
                </button>
              </div>
            )}
          </div>

          {/* Step: Connect */}
          {step === 'connect' && !isConnected && (
            <div className="wallet-area">
              <div className="wallet-title">Connect Your Wallet</div>
              <div className="wallet-sub">
                Connect your Base wallet to browse your NFTs. You can also add a Solana wallet address to include Solana NFTs.
              </div>
              <div className="connector-list">
                {connectors.map(connector => (
                  <button
                    key={connector.uid}
                    className="connector-btn"
                    onClick={() => connect({ connector })}
                  >
                    → {connector.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Step: Solana wallet + fetch */}
          {isConnected && step === 'connect' && (
            <div className="card-body">
              <div className="field-label">SOLANA WALLET (OPTIONAL)</div>
              <div className="solana-input-row">
                <input
                  className="sol-input"
                  placeholder="Solana wallet address..."
                  value={solanaWallet}
                  onChange={e => setSolanaWallet(e.target.value)}
                />
                <button
                  className="fetch-btn"
                  disabled={loading}
                  onClick={() => fetchNFTs(address || '', solanaWallet)}
                >
                  {loading ? '...' : 'LOAD NFTS'}
                </button>
              </div>
              {error && <div className="error-msg" style={{marginTop:12}}>{error}</div>}
            </div>
          )}

          {/* Step: Browse NFTs */}
          {step === 'browse' && (
            <div className="card-body">
              <div className="filter-row">
                {(['all','base','solana'] as const).map(f => (
                  <button key={f} className={`filter-pill${nftFilter===f?' active':''}`} onClick={() => setNftFilter(f)}>
                    {f === 'all' ? `All (${nfts.length})` : f === 'base' ? `Base (${nfts.filter(n=>n.chain==='base').length})` : `Solana (${nfts.filter(n=>n.chain==='solana').length})`}
                  </button>
                ))}
              </div>
              {loading ? (
                <div className="nft-empty loading-pulse">Loading NFTs...</div>
              ) : filteredNFTs.length === 0 ? (
                <div className="nft-empty">No NFTs found on {nftFilter === 'all' ? 'connected wallets' : nftFilter}</div>
              ) : (
                <div className="nft-grid">
                  {filteredNFTs.map(nft => (
                    <div
                      key={`${nft.chain}-${nft.contract}-${nft.tokenId}`}
                      className={`nft-item${selectedNFT?.tokenId === nft.tokenId && selectedNFT?.chain === nft.chain ? ' selected' : ''}`}
                      onClick={() => { setSelectedNFT(nft); setStep('configure'); setTargetWallet(address || ''); }}
                    >
                      {nft.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img className="nft-img" src={nft.imageUrl} alt={nft.name} onError={e => { (e.target as HTMLImageElement).style.display='none'; }}/>
                      ) : (
                        <div className="nft-img-placeholder">NO IMG</div>
                      )}
                      <div className="nft-info">
                        <div className="nft-name">{nft.name}</div>
                        <div className="nft-chain">{nft.chain.toUpperCase()} · {nft.collectionName || truncateAddr(nft.contract)}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Step: Configure mirror */}
          {step === 'configure' && selectedNFT && (
            <div className="card-body">
              <div className="config-section">
                <div className="config-preview">
                  <div className="config-preview-card">
                    {selectedNFT.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img className="config-preview-img" src={selectedNFT.imageUrl} alt={selectedNFT.name}/>
                    ) : (
                      <div style={{width:'100%', aspectRatio:'1', background:faint, display:'flex', alignItems:'center', justifyContent:'center', fontSize:8, color:inkDim}}>NO IMAGE</div>
                    )}
                    <div className="config-preview-name">{selectedNFT.name}</div>
                  </div>
                  <div style={{fontSize:7, color:inkDim, letterSpacing:'1px', marginTop:8, textAlign:'center'}}>
                    {selectedNFT.chain.toUpperCase()} · {truncateAddr(selectedNFT.contract)}
                  </div>
                </div>

                <div className="config-fields">
                  <div>
                    <div className="field-label">TARGET CHAIN (MIRROR LIVES ON)</div>
                    <div className="chain-pills">
                      <button className={`chain-pill${targetChain==='Base'?' active':''}`} onClick={() => setTargetChain('Base')}>Base</button>
                    </div>
                    <div style={{fontSize:7, color:inkDim, marginTop:6, letterSpacing:'0.5px'}}>More chains coming soon</div>
                  </div>

                  <div>
                    <div className="field-label">RECIPIENT WALLET (WHO RECEIVES THE MIRROR)</div>
                    <input
                      className="field-input"
                      placeholder={address || 'Recipient wallet address...'}
                      value={targetWallet}
                      onChange={e => setTargetWallet(e.target.value)}
                    />
                    <div style={{fontSize:7, color:inkDim, marginTop:6, letterSpacing:'0.5px'}}>Leave empty to send to your connected wallet</div>
                  </div>

                  <div style={{background:`${faint}22`, borderRadius:6, padding:'10px 14px', border:`0.8px solid ${faint}`}}>
                    <div style={{fontSize:7, color:inkDim, letterSpacing:'1.5px', marginBottom:8}}>SUMMARY</div>
                    <div style={{fontSize:8, color:ink, lineHeight:1.8}}>
                      Mirror <strong>{selectedNFT.name}</strong> from <strong>{selectedNFT.chain.toUpperCase()}</strong><br/>
                      → Mint on <strong>{targetChain}</strong> as soulbound NFT<br/>
                      → Wrapped in Sealer Mirror SVG<br/>
                      → Ownership verified before mint
                    </div>
                  </div>

                  {error && <div className="error-msg">{error}</div>}

                  <div className="btn-row">
                    <button className="btn" onClick={() => { setStep('browse'); setError(''); }}>← Back</button>
                    <button
                      className="btn btn-primary"
                      onClick={handleMint}
                      disabled={!selectedNFT || !isConnected}
                    >
                      MINT MIRROR
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Step: Minting */}
          {step === 'minting' && (
            <div className="done-area">
              <div className="loading-pulse" style={{fontSize:11, letterSpacing:'3px'}}>MINTING MIRROR...</div>
              <div className="done-sub">Verifying ownership and minting your soulbound mirror NFT. This may take 15–30 seconds.</div>
            </div>
          )}

          {/* Step: Done */}
          {step === 'done' && mintResult && (
            <div className="done-area">
              <div className="done-title">Mirror Minted ✓</div>
              <div className="done-sub">Your soulbound Mirror NFT has been minted on {targetChain}. It reflects the original NFT and will void if the original is transferred.</div>
              <div className="result-box">
                <div className="result-row">
                  <span className="result-key">MIRROR TOKEN ID</span>
                  <span className="result-val">#{mintResult.mirrorTokenId}</span>
                </div>
                <div className="result-row">
                  <span className="result-key">TX HASH</span>
                  <span className="result-val" style={{cursor:'pointer'}} onClick={() => navigator.clipboard.writeText(mintResult.txHash)}>
                    {mintResult.txHash?.slice(0,10)}...
                  </span>
                </div>
                <div className="result-row">
                  <span className="result-key">CHAIN</span>
                  <span className="result-val">{targetChain}</span>
                </div>
              </div>
              <div className="btn-row">
                <a className="btn btn-primary" href={mintResult.permalink} target="_blank" rel="noopener noreferrer">VIEW MIRROR →</a>
                <a className="btn" href={`https://basescan.org/tx/${mintResult.txHash}`} target="_blank" rel="noopener noreferrer">BASESCAN</a>
                <button className="btn" onClick={() => { setStep('browse'); setMintResult(null); setSelectedNFT(null); setError(''); }}>MIRROR ANOTHER</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
