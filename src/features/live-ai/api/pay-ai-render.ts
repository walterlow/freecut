import { encodeFunctionData, parseAbi } from 'viem';
import { getPaymentContractAddress } from '@/config/billing';

const PAY_AI_RENDER_ABI = parseAbi([
  'function payAiRender(uint256 amountUsdc6) external',
]);

export type PayAiRenderFailureReason =
  | 'insufficient_balance'
  | 'session_limit_exceeded'
  | 'rpc_or_unknown';

/**
 * Builds the UserOperation calldata for PaymentContract.payAiRender(amountUsdc6).
 * Returns undefined if payment contract address is not configured.
 */
export function buildPayAiRenderCalldata(amountUsdc6: number): `0x${string}` | undefined {
  const contractAddress = getPaymentContractAddress();
  if (!contractAddress) return undefined;
  return encodeFunctionData({
    abi: PAY_AI_RENDER_ABI,
    functionName: 'payAiRender',
    args: [BigInt(amountUsdc6)],
  });
}

/**
 * Heuristic classification of payment failure for UX (top-up vs re-authorize).
 * Alchemy/Session Key may return different error shapes; extend as needed.
 */
export function classifyPayFailure(error: unknown): PayAiRenderFailureReason {
  const msg = error instanceof Error ? error.message : String(error);
  const lower = msg.toLowerCase();
  if (
    lower.includes('allowance') ||
    lower.includes('insufficient') ||
    lower.includes('balance') ||
    lower.includes('exceeds balance')
  ) {
    return 'insufficient_balance';
  }
  if (
    lower.includes('session') ||
    lower.includes('limit exceeded') ||
    lower.includes('spending limit') ||
    lower.includes('allowance exceeded')
  ) {
    return 'session_limit_exceeded';
  }
  return 'rpc_or_unknown';
}
