'use client';
// src/app/mirror/MirrorInteractivePage.tsx
import { useState, useCallback } from 'react';
import { useAccount, useConnect, useDisconnect } from 'wagmi';
import { useWallet } from '@solana/wallet-adapter-react';
import { useX402Payment } from '@/lib/useX402Payment';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';

type Step = 'connect' | 'browse' | 'configure' | 'minting' | 'done';
type SourceChain = 'base' | 'ethereum' | 'solana';

interface NFTItem {
  chain:           SourceChain;
  contract:        string;
  tokenId:         string;
  name:            string;
  imageUrl:        string;
  collectionName?: string;
}

function truncateAddr(a: string) {
  if (!a) return '';
  return a.slice(0, 6) + '···' + a.slice(-4);
}

const accent   = '#3b82f6';
const bg       = '#060a12';
const hdrBg    = '#0a0f1e';
const ink      = '#c8d8f0';
const inkDim   = '#5a7090';
const faint    = '#1e2d4a';
const warning  = '#f59e0b';
const solGreen = '#9945FF';

export default function MirrorInteractivePage() {
  const { address, isConnected }           = useAccount();
  const { connect, connectors }            = useConnect();
  const { disconnect }                     = useDisconnect();
  const { publicKey, connected: solConnected, disconnect: solDisconnect } = useWallet();

  const solAddress = publicKey?.toBase58() || '';

  const [step,        setStep]        = useState<Step>('connect');
  const [nfts,        setNfts]        = useState<NFTItem[]>([]);
  const [loading,     setLoading]     = useState(false);
  const [selectedNFT, setSelectedNFT] = useState<NFTItem | null>(null);
  const [targetWallet,setTargetWallet]= useState('');
  const [paying,       setPaying]       = useState(false);
  const [targetChain, setTargetChain]  = useState<'Base'|'Solana'>('Base');
  const [showConfirm,  setShowConfirm]  = useState(false);
  const { pay } = useX402Payment();
  const [error,       setError]       = useState('');
  const [mintResult,  setMintResult]  = useState<any>(null);
  const [nftFilter,   setNftFilter]   = useState<'all' | SourceChain>('all');

  const filteredConnectors = connectors.filter(c =>
    c.id === 'injected' || c.id === 'walletConnect'
  );
  const displayConnectors = filteredConnectors.length > 0 ? filteredConnectors : connectors;

  const anyConnected = isConnected || solConnected;

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
    } catch { setError('Failed to load NFTs. Check your connection and try again.'); }
    finally  { setLoading(false); }
  }, []);

  async function handleMint() {
    if (!selectedNFT) return;

    const ownerWallet = selectedNFT.chain === 'solana' ? solAddress : (address || '');
    if (!ownerWallet) return;

    setStep('minting');
    setError('');
    setPaying(true);

    try {
      // ── Step 1: Send USDC payment ───────────────────────────────────────
      // Prefer Solana payment if Solana wallet connected, else Base
      const preferredChain = publicKey ? 'solana' : 'base';
      let paymentResult: { txHash: string; paymentChain: string };
      try {
        paymentResult = await pay('0.20', preferredChain as any);
      } catch (payErr: any) {
        setError(`Payment failed: ${payErr?.message || String(payErr)}`);
        setStep('configure');
        setPaying(false);
        return;
      }
      setPaying(false);

      // ── Step 2: Mint with payment proof ────────────────────────────────
      const recipient = targetWallet || (targetChain === 'Base' ? address : solAddress) || ownerWallet;
      const res = await fetch('/api/mirror/mint', {
        method:  'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-PAYMENT':    paymentResult.txHash,
        },
        body: JSON.stringify({
          originalChain:    selectedNFT.chain,
          originalContract: selectedNFT.contract,
          originalTokenId:  selectedNFT.tokenId,
          ownerWallet,
          recipientWallet:  recipient,
          targetChain,
          nftName:          selectedNFT.name,
          imageUrl:         selectedNFT.imageUrl,
          paymentChain:     paymentResult.paymentChain,
        }),
      });
      let data: any = {};
      try { data = await res.json(); } catch { data = { error: `Server error (${res.status})` }; }
      if (!res.ok) { setError(data.error || 'Mint failed'); setStep('configure'); return; }
      setMintResult(data);
      setStep('done');
    } catch (e: any) {
      setError(String(e));
      setStep('configure');
      setPaying(false);
    }
  }

  const filteredNFTs = nfts.filter(n => nftFilter === 'all' || n.chain === nftFilter);
  const baseCount    = nfts.filter(n => n.chain === 'base').length;
  const ethCount     = nfts.filter(n => n.chain === 'ethereum').length;
  const solanaCount  = nfts.filter(n => n.chain === 'solana').length;

  const needsEVM = false; // kept for JSX compat
  // recipient must be provided or inferable
  const hasRecipient = !!targetWallet || (targetChain === 'Base' ? !!address : !!solAddress);
  const canMint = selectedNFT && hasRecipient && (
    (selectedNFT.chain !== 'solana' && isConnected) ||
    (selectedNFT.chain === 'solana' && solConnected)
  );

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        body {
          background: ${bg}; min-height: 100vh;
          font-family: 'Space Mono', monospace; color: ${ink};
          padding: 24px;
        }
        .wrap { max-width: 860px; margin: 0 auto; display: flex; flex-direction: column; gap: 20px; }
        .card { background: ${hdrBg}; border-radius: 12px; border: 1px solid ${faint}; overflow: hidden; }
        .card-header {
          padding: 16px 24px; border-bottom: 0.8px solid ${faint};
          display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap;
        }
        .card-title { font-size: 11px; color: ${ink}; letter-spacing: 2px; }
        .card-sub   { font-size: 7px; color: ${inkDim}; letter-spacing: 1px; margin-top: 2px; }
        .card-body  { padding: 24px; }
        .accent-bar { height: 2.5px; background: ${accent}; }

        /* Wallet status row */
        .wallets-row { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
        .wallet-badge {
          display: flex; align-items: center; gap: 6px;
          padding: 5px 12px; border-radius: 6px;
          border: 0.8px solid ${faint}; background: ${faint}22;
          font-size: 8px; color: ${ink}; letter-spacing: 0.5px;
        }
        .wallet-dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }
        .dot-evm { background: #22c55e; }
        .dot-sol { background: ${solGreen}; }
        .disconnect-btn {
          padding: 3px 8px; border-radius: 4px; font-size: 6.5px; letter-spacing: 1px;
          cursor: pointer; border: 0.8px solid ${faint}; background: transparent;
          color: ${inkDim}; font-family: monospace; transition: all .15s; margin-left: 4px;
        }
        .disconnect-btn:hover { border-color: #ef4444; color: #ef4444; }

        /* Connect screen */
        .connect-area { display: flex; flex-direction: column; gap: 24px; padding: 32px 24px; }
        .connect-col { display: flex; flex-direction: column; gap: 12px; }
        .connect-label { font-size: 7px; color: ${inkDim}; letter-spacing: 2px; margin-bottom: 4px; }
        .connect-split { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }

        .connector-btn {
          padding: 11px 16px; border-radius: 8px; font-size: 9px; font-weight: 700;
          letter-spacing: 1.5px; cursor: pointer; border: 0.8px solid ${accent};
          background: transparent; color: ${accent}; font-family: monospace;
          transition: all .15s; text-align: left; width: 100%;
        }
        .connector-btn:hover { background: ${accent}18; }

        /* Override wallet adapter button styles */
        .wallet-adapter-button {
          background: transparent !important;
          border: 0.8px solid ${solGreen} !important;
          border-radius: 8px !important;
          color: ${solGreen} !important;
          font-family: 'Space Mono', monospace !important;
          font-size: 9px !important;
          font-weight: 700 !important;
          letter-spacing: 1.5px !important;
          height: auto !important;
          padding: 11px 16px !important;
          width: 100% !important;
          justify-content: flex-start !important;
          line-height: 1 !important;
        }
        .wallet-adapter-button:hover { background: ${solGreen}18 !important; }
        .wallet-adapter-button-start-icon { display: none !important; }
        .wallet-adapter-modal-wrapper { font-family: 'Space Mono', monospace !important; }

        .load-btn {
          padding: 10px 20px; border-radius: 8px; font-size: 9px; font-weight: 700;
          letter-spacing: 1.5px; cursor: pointer; border: 0.8px solid ${accent};
          background: ${accent}; color: #fff; font-family: monospace;
          transition: all .15s; width: 100%;
        }
        .load-btn:disabled { opacity: 0.4; cursor: default; }

        /* NFT grid */
        .filter-row { display: flex; gap: 8px; margin-bottom: 16px; flex-wrap: wrap; }
        .filter-pill {
          padding: 4px 12px; border-radius: 12px; font-size: 7px; letter-spacing: 1px;
          cursor: pointer; border: 0.8px solid ${faint};
          background: transparent; color: ${inkDim}; font-family: monospace; transition: all .15s;
        }
        .filter-pill.active { border-color: ${accent}; color: ${accent}; background: ${accent}18; }

        .nft-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 12px; }
        .nft-item {
          border-radius: 8px; overflow: hidden; cursor: pointer;
          border: 1.5px solid ${faint}; transition: all .15s; background: ${faint}22;
          position: relative;
        }
        .nft-item:hover { border-color: ${accent}88; transform: translateY(-1px); }
        .nft-item.selected { border-color: ${accent}; box-shadow: 0 0 12px ${accent}44; }
        .nft-item.sol-locked { cursor: not-allowed; opacity: 0.5; }
        .nft-item.sol-locked:hover { transform: none; border-color: ${warning}44; }
        .chain-badge {
          position: absolute; top: 6px; left: 6px;
          border-radius: 4px; padding: 2px 6px;
          font-size: 6px; letter-spacing: 1px;
        }
        .badge-sol { background: ${solGreen}22; border: 0.8px solid ${solGreen}44; color: ${solGreen}; }
        .badge-eth { background: #627EEA22; border: 0.8px solid #627EEA44; color: #627EEA; }
        .badge-base { background: ${accent}22; border: 0.8px solid ${accent}44; color: ${accent}; }
        .badge-v2 { background: ${warning}22; border: 0.8px solid ${warning}44; color: ${warning}; }

        .nft-img { width: 100%; aspect-ratio: 1; object-fit: cover; display: block; background: ${faint}; }
        .nft-img-placeholder { width: 100%; aspect-ratio: 1; background: ${faint}; display: flex; align-items: center; justify-content: center; font-size: 8px; color: ${inkDim}; }
        .nft-info { padding: 8px; }
        .nft-name { font-size: 8px; color: ${ink}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .nft-chain { font-size: 6.5px; color: ${inkDim}; margin-top: 2px; }
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
        .config-preview-name { padding: 8px 10px; font-size: 9px; font-weight: 700; color: rgba(20,40,100,0.9); }
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
          background: transparent; color: ${inkDim}; font-family: monospace; transition: all .15s;
        }
        .chain-pill.active { border-color: ${accent}; color: ${accent}; background: ${accent}18; }

        .summary-box { background: ${faint}22; border-radius: 6px; padding: 10px 14px; border: 0.8px solid ${faint}; }
        .summary-label { font-size: 7px; color: ${inkDim}; letter-spacing: 1.5px; margin-bottom: 8px; }
        .summary-text { font-size: 8px; color: ${ink}; line-height: 1.8; }

        .btn-row { display: flex; gap: 10px; margin-top: 8px; flex-wrap: wrap; }
        .btn {
          padding: 11px 20px; border-radius: 8px; font-size: 9px; font-weight: 700;
          letter-spacing: 1.5px; cursor: pointer; border: 0.8px solid ${faint};
          background: transparent; color: ${inkDim}; font-family: monospace; transition: all .15s;
          text-decoration: none; display: inline-flex; align-items: center;
        }
        .btn:hover { border-color: ${accent}88; color: ${ink}; }
        .btn-primary { background: ${accent}; border-color: ${accent}; color: #fff; }
        .btn-primary:hover { box-shadow: 0 0 20px ${accent}66; transform: translateY(-1px); }
        .btn-primary:disabled { opacity: 0.4; cursor: default; transform: none; box-shadow: none; }

        .done-area { display: flex; flex-direction: column; align-items: center; gap: 20px; padding: 40px 24px; text-align: center; }
        .done-title { font-family: Georgia, serif; font-size: 20px; color: ${ink}; }
        .done-sub { font-size: 9px; color: ${inkDim}; letter-spacing: 1px; max-width: 400px; line-height: 1.7; }
        .result-box { background: ${faint}22; border: 0.8px solid ${faint}; border-radius: 8px; padding: 16px; width: 100%; max-width: 420px; text-align: left; }
        .result-row { display: flex; justify-content: space-between; align-items: center; padding: 6px 0; border-bottom: 0.5px solid ${faint}33; }
        .result-row:last-child { border-bottom: none; }
        .result-key { font-size: 7px; color: ${inkDim}; letter-spacing: 1px; }
        .result-val { font-size: 8px; color: ${ink}; }

        .error-msg { padding: 10px 16px; background: #ef444422; border: 0.8px solid #ef444440; border-radius: 6px; font-size: 8px; color: #ef4444; }
        .loading-pulse { font-size: 9px; color: ${inkDim}; letter-spacing: 1px; animation: pulse 1.5s infinite; }
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
        .divider { height: 0.8px; background: ${faint}; margin: 20px 0; }

        @media (max-width: 600px) {
          .config-section { flex-direction: column; }
          .nft-grid { grid-template-columns: repeat(2, 1fr); }
          .connect-split { grid-template-columns: 1fr; }
        }
      `}</style>

      <div className="wrap">
        <div className="card">
          <div className="accent-bar"/>
          <div className="card-header">
            <div>
              <div className="card-title">MIRROR AN NFT</div>
              <div className="card-sub">WRAP ANY NFT IN A SEALER MIRROR · BASE + ETH + SOLANA · $0.20 USDC</div>
            </div>
            {anyConnected && (
              <div className="wallets-row">
                {isConnected && (
                  <div className="wallet-badge">
                    <div className="wallet-dot dot-evm"/>
                    <span>{truncateAddr(address || '')}</span>
                    <button className="disconnect-btn" onClick={() => { disconnect(); if (!solConnected) { setStep('connect'); setNfts([]); setSelectedNFT(null); } }}>✕</button>
                  </div>
                )}
                {solConnected && (
                  <div className="wallet-badge" style={{borderColor:`${solGreen}44`}}>
                    <div className="wallet-dot dot-sol"/>
                    <span style={{color: solGreen}}>{truncateAddr(solAddress)}</span>
                    <button className="disconnect-btn" onClick={() => { solDisconnect(); if (!isConnected) { setStep('connect'); setNfts([]); setSelectedNFT(null); } }}>✕</button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ── Step: Connect ─────────────────────────────────────────── */}
          {step === 'connect' && !anyConnected && (
            <div className="card-body">
              <div style={{textAlign:'center', marginBottom:24}}>
                <div style={{fontFamily:'Georgia,serif', fontSize:20, color:ink, marginBottom:8}}>Connect Your Wallet</div>
                <div style={{fontSize:9, color:inkDim, maxWidth:460, margin:'0 auto', lineHeight:1.7}}>
                  Connect an EVM wallet for Base + Ethereum NFTs, a Solana wallet for Solana NFTs, or both.
                </div>
              </div>
              <div className="connect-split">
                <div className="connect-col">
                  <div className="connect-label">EVM WALLET (BASE + ETHEREUM)</div>
                  {displayConnectors.map(connector => (
                    <button key={connector.uid} className="connector-btn" onClick={() => connect({ connector })}>
                      → {connector.name === 'Injected' ? 'Browser Wallet' : connector.name}
                    </button>
                  ))}
                </div>
                <div className="connect-col">
                  <div className="connect-label" style={{color: solGreen}}>SOLANA WALLET</div>
                  <WalletMultiButton/>
                </div>
              </div>
            </div>
          )}

          {/* ── Connected but not browsed yet ─────────────────────────── */}
          {anyConnected && step === 'connect' && (
            <div className="card-body">
              <div style={{fontSize:9, color:inkDim, marginBottom:16, letterSpacing:'0.5px', lineHeight:1.7}}>
                {isConnected && solConnected
                  ? `Ready to load NFTs from Base + Ethereum (${truncateAddr(address||'')}) and Solana (${truncateAddr(solAddress)}).`
                  : isConnected
                  ? `Ready to load Base + Ethereum NFTs. Connect a Solana wallet above to also browse Solana NFTs.`
                  : `Ready to load Solana NFTs. Connect an EVM wallet above to also browse Base + Ethereum NFTs.`
                }
              </div>

              {/* Show connect options for whichever isn't connected */}
              {!isConnected && (
                <div style={{marginBottom:16}}>
                  <div className="connect-label" style={{marginBottom:8}}>ADD EVM WALLET (OPTIONAL)</div>
                  <div style={{display:'flex', gap:8, flexWrap:'wrap'}}>
                    {displayConnectors.map(connector => (
                      <button key={connector.uid} className="connector-btn" style={{width:'auto', flex:'0 0 auto'}} onClick={() => connect({ connector })}>
                        → {connector.name === 'Injected' ? 'Browser Wallet' : connector.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {!solConnected && (
                <div style={{marginBottom:16}}>
                  <div className="connect-label" style={{marginBottom:8, color:solGreen}}>ADD SOLANA WALLET (OPTIONAL)</div>
                  <WalletMultiButton/>
                </div>
              )}

              <div className="divider"/>
              <button
                className="load-btn"
                disabled={loading}
                onClick={() => fetchNFTs(address || '', solAddress)}
              >
                {loading ? 'Loading NFTs...' : 'LOAD MY NFTS →'}
              </button>
              {error && <div className="error-msg" style={{marginTop:12}}>{error}</div>}
            </div>
          )}

          {/* ── Step: Browse NFTs ────────────────────────────────────── */}
          {step === 'browse' && (
            <div className="card-body">
              <div className="filter-row">
                {([
                  ['all',      `All (${nfts.length})`],
                  ['base',     `Base (${baseCount})`],
                  ['ethereum', `ETH (${ethCount})`],
                  ['solana',   `Solana (${solanaCount})`],
                ] as [string, string][]).map(([f, label]) => (
                  <button key={f} className={`filter-pill${nftFilter===f?' active':''}`} onClick={() => setNftFilter(f as any)}>
                    {label}
                  </button>
                ))}
                <button className="filter-pill" style={{marginLeft:'auto'}} onClick={() => fetchNFTs(address||'', solAddress)}>
                  ↻ Refresh
                </button>
              </div>

              {loading ? (
                <div className="nft-empty loading-pulse">Loading NFTs...</div>
              ) : filteredNFTs.length === 0 ? (
                <div className="nft-empty">No NFTs found</div>
              ) : (
                <div className="nft-grid">
                  {filteredNFTs.map(nft => {
                    const isSolLocked = nft.chain === 'solana' && !solConnected;
                    const isSelected  = selectedNFT?.tokenId === nft.tokenId && selectedNFT?.chain === nft.chain;
                    return (
                      <div
                        key={`${nft.chain}-${nft.contract}-${nft.tokenId}`}
                        className={`nft-item${isSelected?' selected':''}${isSolLocked?' sol-locked':''}`}
                        onClick={() => {
                          if (isSolLocked) return;
                          setSelectedNFT(nft);
                          setStep('configure');
                          setTargetWallet('');
                        }}
                      >
                        <span className={`chain-badge badge-${nft.chain === 'ethereum' ? 'eth' : nft.chain}`}>
                          {nft.chain === 'ethereum' ? 'ETH' : nft.chain.toUpperCase()}
                        </span>
                        {isSolLocked && <span className="chain-badge badge-v2" style={{left:'auto', right:6}}>CONNECT</span>}
                        {nft.imageUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img className="nft-img" src={nft.imageUrl} alt={nft.name}
                            onError={e => { (e.target as HTMLImageElement).style.display='none'; }}/>
                        ) : (
                          <div className="nft-img-placeholder">NO IMG</div>
                        )}
                        <div className="nft-info">
                          <div className="nft-name">{nft.name}</div>
                          <div className="nft-chain">{truncateAddr(nft.contract)}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* ── Step: Configure ────────────────────────────────────────── */}
          {step === 'configure' && selectedNFT && (
            <div className="card-body">
              <div className="config-section">
                <div className="config-preview">
                  <div className="config-preview-card">
                    {selectedNFT.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img className="config-preview-img" src={selectedNFT.imageUrl} alt={selectedNFT.name}/>
                    ) : (
                      <div style={{width:'100%',aspectRatio:'1',background:faint,display:'flex',alignItems:'center',justifyContent:'center',fontSize:8,color:inkDim}}>NO IMAGE</div>
                    )}
                    <div className="config-preview-name">{selectedNFT.name}</div>
                  </div>
                  <div style={{fontSize:7,color:inkDim,letterSpacing:'1px',marginTop:8,textAlign:'center'}}>
                    {selectedNFT.chain.toUpperCase()} · {truncateAddr(selectedNFT.contract)}
                  </div>
                </div>

                <div className="config-fields">
                  <div>
                    <div className="field-label">TARGET CHAIN (MIRROR LIVES ON)</div>
                    <div className="chain-pills">
                      <button
                        className={`chain-pill${targetChain==='Base'?' active':''}`}
                        onClick={() => { setTargetChain('Base'); setTargetWallet(''); }}
                      >Base</button>
                      <button
                        className={`chain-pill${targetChain==='Solana'?' active':''}`}
                        style={targetChain==='Solana'?{borderColor:solGreen,color:solGreen,background:`${solGreen}18`}:{}}
                        onClick={() => { setTargetChain('Solana'); setTargetWallet(''); }}
                      >Solana</button>
                    </div>
                    {targetChain === 'Solana' && !solConnected && (
                      <div style={{fontSize:7,color:warning,marginTop:6,letterSpacing:'0.5px'}}>
                        ⚠ Connect Phantom above to auto-fill your Solana address, or type one below
                      </div>
                    )}
                  </div>

                  {/* Recipient — dynamic based on target chain */}
                  <div>
                    <div className="field-label">
                      RECIPIENT {targetChain === 'Solana' ? 'SOLANA' : 'BASE'} WALLET
                    </div>
                    <input
                      className="field-input"
                      placeholder={
                        targetChain === 'Solana'
                          ? (solAddress || 'Solana wallet address...')
                          : (address    || '0x... Base wallet address')
                      }
                      value={targetWallet}
                      onChange={e => setTargetWallet(e.target.value)}
                    />
                    <div style={{fontSize:7,color:inkDim,marginTop:6}}>
                      {targetChain === 'Solana'
                        ? solAddress
                          ? <>Defaults to your connected Solana wallet — {truncateAddr(solAddress)}</>
                          : 'Enter any Solana wallet address to receive the Mirror NFT'
                        : address
                          ? <>Defaults to your connected EVM wallet — {truncateAddr(address)}</>
                          : 'Enter any Base wallet address to receive the Mirror NFT'
                      }
                    </div>
                  </div>

                  <div className="summary-box">
                    <div className="summary-label">SUMMARY</div>
                    <div className="summary-text">
                      Mirror <strong>{selectedNFT.name}</strong> from <strong>{selectedNFT.chain.toUpperCase()}</strong><br/>
                      → Mint on <strong>{targetChain}</strong> as soulbound NFT<br/>
                      → Wrapped in Sealer Mirror SVG<br/>
                      → Ownership verified before mint<br/>
                      → <strong>$0.20 USDC</strong> via x402
                    </div>
                  </div>

                  {error && <div className="error-msg">{error}</div>}

                  {/* Confirm overlay */}
                  {showConfirm && (
                    <div style={{background:`${faint}44`,border:`0.8px solid ${accent}44`,borderRadius:8,padding:'16px',display:'flex',flexDirection:'column',gap:10}}>
                      <div style={{fontSize:9,color:ink,letterSpacing:'1px'}}>CONFIRM MINT</div>
                      <div style={{fontSize:8,color:inkDim,lineHeight:1.7}}>
                        You are about to mint a Mirror NFT for <strong style={{color:ink}}>$0.20 USDC</strong>.<br/>
                        NFT: <strong style={{color:ink}}>{selectedNFT.name}</strong><br/>
                        Recipient: <strong style={{color:ink}}>{targetWallet ? truncateAddr(targetWallet) : truncateAddr(targetChain==='Solana'?solAddress:address||'')} ({targetChain})</strong>
                      </div>
                      <div className="btn-row" style={{marginTop:0}}>
                        <button className="btn" onClick={() => setShowConfirm(false)}>Cancel</button>
                        <button className="btn btn-primary" onClick={() => { setShowConfirm(false); handleMint(); }}>
                          CONFIRM — $0.20 USDC
                        </button>
                      </div>
                    </div>
                  )}

                  {!showConfirm && (
                    <div className="btn-row">
                      <button className="btn" onClick={() => { setStep('browse'); setError(''); }}>← Back</button>
                      <button
                        className="btn btn-primary"
                        onClick={() => setShowConfirm(true)}
                        disabled={!canMint}
                      >
                        MINT MIRROR — $0.20
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ── Step: Minting ───────────────────────────────────────────── */}
          {step === 'minting' && (
            <div className="done-area">
              <div className="loading-pulse" style={{fontSize:11,letterSpacing:'3px'}}>
                {paying ? 'APPROVING PAYMENT...' : 'MINTING MIRROR...'}
              </div>
              <div className="done-sub">
                {paying
                  ? 'Approve the $0.20 USDC transaction in your wallet.'
                  : `Verifying ownership and minting your soulbound mirror NFT on ${targetChain}. This may take 15–30 seconds.`
                }
              </div>
            </div>
          )}

          {/* ── Step: Done ──────────────────────────────────────────────── */}
          {step === 'done' && mintResult && (
            <div className="done-area">
              <div className="done-title">Mirror Minted ✓</div>
              <div className="done-sub">Your soulbound Mirror NFT has been minted on Base. It reflects the original NFT and will void if the original is transferred.</div>
              <div className="result-box">
                <div className="result-row">
                  <span className="result-key">MIRROR TOKEN ID</span>
                  <span className="result-val">#{mintResult.mirrorTokenId}</span>
                </div>
                <div className="result-row">
                  <span className="result-key">TX HASH</span>
                  <span className="result-val" style={{cursor:'pointer'}} onClick={() => navigator.clipboard.writeText(mintResult.txHash)}>
                    {mintResult.txHash?.slice(0,10)}···
                  </span>
                </div>
                <div className="result-row">
                  <span className="result-key">CHAIN</span>
                  <span className="result-val">Base</span>
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