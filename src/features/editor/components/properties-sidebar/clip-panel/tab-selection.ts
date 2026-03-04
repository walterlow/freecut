export type ClipPanelTab = 'transform' | 'effects' | 'media';

interface ClipPanelTabAvailability {
  showTransformTab: boolean;
  showEffectsTab: boolean;
  showMediaTab: boolean;
}

export function resolveClipPanelTab(
  currentTab: ClipPanelTab,
  tabAvailability: ClipPanelTabAvailability
): ClipPanelTab {
  const orderedTabs: ClipPanelTab[] = ['transform', 'effects', 'media'];

  const isEnabled = (tab: ClipPanelTab) => {
    if (tab === 'transform') return tabAvailability.showTransformTab;
    if (tab === 'effects') return tabAvailability.showEffectsTab;
    return tabAvailability.showMediaTab;
  };

  if (isEnabled(currentTab)) {
    return currentTab;
  }

  return orderedTabs.find(isEnabled) ?? 'media';
}
