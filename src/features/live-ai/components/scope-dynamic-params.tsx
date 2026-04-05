import { useState, useCallback, useEffect, memo } from 'react';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { PipelineParamSchema } from '../api/scope-pipeline';
import { updateScopeDynamicParam } from '../api/scope-parameters';

interface ScopeDynamicParamsProps {
  schema: PipelineParamSchema[];
  dataChannel: RTCDataChannel | null;
}

/**
 * Dynamically renders parameter controls from Scope's pipeline schema.
 * Each control sends updates immediately via the WebRTC data channel.
 * This ensures the UI auto-adapts to any custom pipeline without frontend code changes.
 */
export const ScopeDynamicParams = memo(function ScopeDynamicParams({
  schema,
  dataChannel,
}: ScopeDynamicParamsProps) {
  const [values, setValues] = useState<Record<string, unknown>>({});

  // Initialize default values from schema
  useEffect(() => {
    const defaults: Record<string, unknown> = {};
    for (const field of schema) {
      if (field.default !== undefined) {
        defaults[field.name] = field.default;
      }
    }
    setValues(defaults);
  }, [schema]);

  const updateParam = useCallback(
    (key: string, value: unknown) => {
      setValues((prev) => ({ ...prev, [key]: value }));
      if (dataChannel) {
        updateScopeDynamicParam(dataChannel, key, value);
      }
    },
    [dataChannel],
  );

  if (schema.length === 0) return null;

  return (
    <div className="flex flex-col gap-3">
      <Label className="text-xs font-medium text-muted-foreground">Pipeline Parameters</Label>
      {schema.map((field) => (
        <DynamicField
          key={field.name}
          field={field}
          value={values[field.name]}
          onChange={(v) => updateParam(field.name, v)}
        />
      ))}
    </div>
  );
});

interface DynamicFieldProps {
  field: PipelineParamSchema;
  value: unknown;
  onChange: (value: unknown) => void;
}

function DynamicField({ field, value, onChange }: DynamicFieldProps) {
  switch (field.type) {
    case 'number':
      return (
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between">
            <Label className="text-xs">{field.name}</Label>
            <span className="text-xs text-muted-foreground">
              {typeof value === 'number' ? value.toFixed(2) : String(field.default ?? 0)}
            </span>
          </div>
          <Slider
            min={field.min ?? 0}
            max={field.max ?? 1}
            step={field.step ?? 0.01}
            value={[typeof value === 'number' ? value : (field.default as number) ?? 0]}
            onValueChange={([v]) => onChange(v)}
          />
          {field.description && (
            <p className="text-[10px] text-muted-foreground">{field.description}</p>
          )}
        </div>
      );

    case 'boolean':
      return (
        <div className="flex items-center justify-between">
          <div>
            <Label className="text-xs">{field.name}</Label>
            {field.description && (
              <p className="text-[10px] text-muted-foreground">{field.description}</p>
            )}
          </div>
          <Switch
            checked={typeof value === 'boolean' ? value : (field.default as boolean) ?? false}
            onCheckedChange={onChange}
            className="scale-75"
          />
        </div>
      );

    case 'string':
      if (field.enum && field.enum.length > 0) {
        return (
          <div className="flex flex-col gap-1">
            <Label className="text-xs">{field.name}</Label>
            <Select
              value={typeof value === 'string' ? value : (field.default as string) ?? ''}
              onValueChange={onChange}
            >
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {field.enum.map((opt) => (
                  <SelectItem key={opt} value={opt} className="text-xs">
                    {opt}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        );
      }
      return (
        <div className="flex flex-col gap-1">
          <Label className="text-xs">{field.name}</Label>
          <Input
            type="text"
            value={typeof value === 'string' ? value : ''}
            onChange={(e) => onChange(e.target.value)}
            placeholder={field.description ?? field.name}
            className="h-8 text-xs"
          />
        </div>
      );

    default:
      return null;
  }
}
