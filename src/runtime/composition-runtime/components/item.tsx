import React from 'react'
import { CompositionContent } from './composition-content'
import { ItemContent, type ItemProps, type RenderCompositionContentProps } from './item-content'

export type { MaskInfo } from './item-content'

function renderCompositionContent(props: RenderCompositionContentProps) {
  return <CompositionContent {...props} />
}

export const Item = React.memo<Omit<ItemProps, 'renderCompositionContent'>>((props) => (
  <ItemContent {...props} renderCompositionContent={renderCompositionContent} />
))
