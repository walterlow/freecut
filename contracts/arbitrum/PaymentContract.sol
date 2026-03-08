// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * Accepts USDC payments for Live AI render and forwards to treasury.
 * Called by Smart Account (Session Key) every 5 minutes while streaming.
 * Arbitrum One USDC: 0xaf88d065e77c8cC2239327C5EDb3A432268e5831
 *
 * Phase 2: payWithRoyalty splits the interval amount: cost to treasury, remainder to platform + creator.
 * Aligned with develop-secure-contracts: Ownable, ReentrancyGuard, SafeERC20 from OpenZeppelin.
 */
contract PaymentContract is Ownable, ReentrancyGuard {
  using SafeERC20 for IERC20;

  address public immutable USDC;
  address public treasury;
  address public platform;

  event Paid(address indexed from_, uint256 amountUsdc6);
  event PaidWithRoyalty(address indexed from_, uint256 amountUsdc6, address indexed creator);
  event TreasurySet(address indexed treasury);
  event PlatformSet(address indexed platform);

  constructor(address usdc_, address treasury_, address platform_) Ownable(msg.sender) {
    USDC = usdc_;
    treasury = treasury_;
    platform = platform_;
  }

  /**
   * Transfer amountUsdc6 USDC (6 decimals) from msg.sender to treasury.
   * msg.sender must have approved this contract for at least amountUsdc6.
   */
  function payAiRender(uint256 amountUsdc6) external nonReentrant {
    if (amountUsdc6 == 0) return;
    IERC20(USDC).safeTransferFrom(msg.sender, treasury, amountUsdc6);
    emit Paid(msg.sender, amountUsdc6);
  }

  /**
   * Pay for AI render with royalty split: half to treasury (cost), half split 50/50 platform and creator.
   * Call when user is using a gated style and holds the required MeToken.
   * amountUsdc6 should be the full interval (e.g. 250_000 for $0.25). Creator is the style owner from the Stylus registry.
   */
  function payWithRoyalty(uint256 amountUsdc6, address creatorAddress) external nonReentrant {
    if (amountUsdc6 == 0) return;
    uint256 half = amountUsdc6 / 2;
    uint256 quarter = half / 2;
    IERC20(USDC).safeTransferFrom(msg.sender, address(this), amountUsdc6);
    IERC20(USDC).safeTransfer(treasury, half);
    IERC20(USDC).safeTransfer(platform, quarter);
    IERC20(USDC).safeTransfer(creatorAddress, quarter);
    emit PaidWithRoyalty(msg.sender, amountUsdc6, creatorAddress);
  }

  function setTreasury(address treasury_) external onlyOwner {
    treasury = treasury_;
    emit TreasurySet(treasury_);
  }

  function setPlatform(address platform_) external onlyOwner {
    platform = platform_;
    emit PlatformSet(platform_);
  }
}
