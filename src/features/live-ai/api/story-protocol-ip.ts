/**
 * Story Protocol IP registration (Phase 2).
 * When a style is registered on Arbitrum (Stylus registerStyle), call Story Protocol
 * to mint and register an IP asset with optional commercial license.
 *
 * Integration options:
 * A) Backend: listen for registerStyle events, call @story-protocol/core-sdk registerIpAsset.
 * B) Frontend: after user submits registerStyle tx, call this with styleId and metadata.
 *
 * Required: add dependency @story-protocol/core-sdk and implement registerIpAsset with:
 * - type: "mint" (mint new NFT + register) or "minted" (register existing NFT)
 * - ipMetadata, nftMetadataURI, optional licenseTermsData, royaltyShares
 *
 * Store mapping styleId -> ipAssetId for Task 2.3 (payWithRoyalty).
 */

export interface StoryIpRegistrationParams {
  styleId: string;
  creatorAddress: string;
  ipMetadataUri: string;
  ipMetadataHash: string;
  nftMetadataUri?: string;
  licenseTermsData?: unknown;
  royaltyShares?: Array<{ recipient: string; share: number }>;
}

export interface StoryIpRegistrationResult {
  ipAssetId: string;
  tokenId?: string;
}

/**
 * Register the given style as an IP asset on Story Protocol.
 * Implement by wiring to @story-protocol/core-sdk (IPAssetClient.registerIpAsset).
 */
export async function registerStyleAsIpAsset(
  params: StoryIpRegistrationParams
): Promise<StoryIpRegistrationResult> {
  void params;
  throw new Error(
    'Story Protocol IP registration not implemented. Add @story-protocol/core-sdk and implement registerIpAsset (see docs.story.foundation/developers/typescript-sdk/register-ip-asset).'
  );
}
