'use client';

import {
  usePrepareSwap,
  useSignAndSendPreparedCalls,
  useSmartAccountClient,
} from '@account-kit/react';
import type { Chain } from 'viem';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { USDC_ADDRESS_BY_CHAIN_ID } from '@/config/chains';
import { chainIdToHex, decimalAmountToHex, NATIVE_TOKEN_ADDRESS } from '@/lib/swap-utils';

const USDC_DECIMALS = 6;

interface CrossChainSwapModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  chain: Chain | undefined;
  chains: readonly Chain[];
}

export function CrossChainSwapModal({
  open,
  onOpenChange,
  chain,
  chains,
}: CrossChainSwapModalProps) {
  const [amount, setAmount] = useState('');
  const [toChainId, setToChainId] = useState<number | null>(null);
  const [fromTokenIsUsdc, setFromTokenIsUsdc] = useState(true);

  const { client } = useSmartAccountClient();
  const {
    prepareSwapAsync,
    isPreparingSwap,
    error: quoteError,
    reset: resetQuote,
  } = usePrepareSwap({ client });
  const {
    signAndSendPreparedCallsAsync,
    isSigningAndSendingPreparedCalls,
    error: sendError,
    reset: resetSend,
  } = useSignAndSendPreparedCalls({ client });

  const fromChain = chain;
  const toChain = toChainId != null ? chains.find((c) => c.id === toChainId) : undefined;
  const fromUsdc = fromChain ? USDC_ADDRESS_BY_CHAIN_ID[fromChain.id] : undefined;
  const toUsdc = toChain ? USDC_ADDRESS_BY_CHAIN_ID[toChain.id] : undefined;
  const fromToken = fromTokenIsUsdc ? fromUsdc : NATIVE_TOKEN_ADDRESS;
  const toToken = fromTokenIsUsdc ? (toUsdc ?? NATIVE_TOKEN_ADDRESS) : (toUsdc ?? NATIVE_TOKEN_ADDRESS);
  const decimals = fromTokenIsUsdc ? USDC_DECIMALS : 18;
  const canSwap =
    fromChain &&
    toChain &&
    fromChain.id !== toChain.id &&
    fromToken &&
    toToken &&
    amount &&
    parseFloat(amount) > 0 &&
    client;
  const isBusy = isPreparingSwap || isSigningAndSendingPreparedCalls;
  const error = quoteError ?? sendError;

  const handleSwap = async () => {
    if (!canSwap || !fromChain || !toChain) return;
    resetQuote();
    resetSend();
    try {
      const fromAmountHex = decimalAmountToHex(amount, decimals);
      const result = await prepareSwapAsync({
        chainId: chainIdToHex(fromChain.id),
        toChainId: chainIdToHex(toChain.id),
        fromToken,
        toToken,
        fromAmount: fromAmountHex,
      } as Parameters<typeof prepareSwapAsync>[0]);
      if (result && 'signatureRequest' in result) {
        await signAndSendPreparedCallsAsync(result as never);
        setAmount('');
        setToChainId(null);
        onOpenChange(false);
      }
    } catch {
      // Error surfaced via quoteError / sendError
    }
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setAmount('');
      setToChainId(null);
      resetQuote();
      resetSend();
    }
    onOpenChange(next);
  };

  if (!chain) return null;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Cross-chain swap</DialogTitle>
          <DialogDescription>
            Move tokens from {chain.name} to another network. May take longer than same-chain swaps.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <label className="text-sm font-medium">From chain</label>
            <p className="text-muted-foreground text-sm">{fromChain?.name ?? '—'}</p>
          </div>
          <div className="grid gap-2">
            <label className="text-sm font-medium">To chain</label>
            <select
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
              value={toChainId ?? ''}
              onChange={(e) =>
                setToChainId(e.target.value === '' ? null : parseInt(e.target.value, 10))
              }
            >
              <option value="">Select network</option>
              {chains
                .filter((c) => c.id !== chain?.id)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </select>
          </div>
          <div className="grid gap-2">
            <label className="text-sm font-medium">From token</label>
            <select
              className="flex h-9 w-32 rounded-md border border-input bg-transparent px-3 py-1 text-sm"
              value={fromTokenIsUsdc ? 'usdc' : 'native'}
              onChange={(e) => setFromTokenIsUsdc(e.target.value === 'usdc')}
            >
              <option value="usdc">USDC</option>
              <option value="native">{fromChain?.nativeCurrency.symbol ?? 'Native'}</option>
            </select>
          </div>
          <div className="grid gap-2">
            <label className="text-sm font-medium">Amount</label>
            <input
              type="text"
              inputMode="decimal"
              placeholder="0.0"
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
          {error && (
            <p className="text-destructive text-sm">
              {error instanceof Error ? error.message : 'Swap failed'}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={isBusy}
          >
            Cancel
          </Button>
          <Button onClick={handleSwap} disabled={!canSwap || isBusy}>
            {isPreparingSwap
              ? 'Getting quote…'
              : isSigningAndSendingPreparedCalls
                ? 'Signing & sending…'
                : 'Swap'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
