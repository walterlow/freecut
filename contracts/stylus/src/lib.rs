//! Style registry: hash AI pipeline config (prompt, LoRA CID, config JSON) and assign to creator.
//! For use with Story Protocol IP and MeToken royalty gating (Phase 2).
#![cfg_attr(not(feature = "export-abi"), no_main)]
extern crate alloc;

use alloy_primitives::{Address, B256};
use stylus_sdk::crypto::keccak;
use stylus_sdk::msg;
use stylus_sdk::prelude::*;
use stylus_sdk::storage::*;

#[storage]
#[entrypoint]
pub struct StyleRegistry {
    /// style_id (keccak256 of pipeline) -> creator address
    style_owner: StorageMap<B256, StorageAddress>,
}

#[public]
impl StyleRegistry {
    /// Register a style: style_id = keccak256(prompt_hash, lora_cid_hash, config_json_hash); set caller as owner.
    /// Client hashes lora_cid and config_json off-chain to keep calldata small.
    pub fn register_style(
        &mut self,
        prompt_hash: B256,
        lora_cid_hash: B256,
        config_json_hash: B256,
    ) -> Result<B256, Vec<u8>> {
        let style_id = Self::compute_style_id(prompt_hash, lora_cid_hash, config_json_hash);
        let owner = msg::sender();
        self.style_owner.setter(style_id).set(owner);
        Ok(style_id)
    }

    /// Get the creator address for a style id.
    pub fn get_style_owner(&self, style_id: B256) -> Address {
        self.style_owner.get(style_id)
    }

    fn compute_style_id(prompt_hash: B256, lora_cid_hash: B256, config_json_hash: B256) -> B256 {
        let mut preimage = [0u8; 96];
        preimage[0..32].copy_from_slice(prompt_hash.as_slice());
        preimage[32..64].copy_from_slice(lora_cid_hash.as_slice());
        preimage[64..96].copy_from_slice(config_json_hash.as_slice());
        keccak(preimage)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use alloy_primitives::U256;

    #[test]
    fn compute_style_id_deterministic() {
        let a = B256::ZERO;
        let b = B256::from(U256::from(1));
        let c = B256::from(U256::from(2));
        let id1 = StyleRegistry::compute_style_id(a, b, c);
        let id2 = StyleRegistry::compute_style_id(a, b, c);
        assert_eq!(id1, id2);
    }
}
