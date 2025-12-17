import { useState, useRef } from 'react';
import { toast } from 'sonner';
import { Upload } from 'lucide-react';
import { createLogger } from '@/lib/logger';

const logger = createLogger('UploadDropzone');
import { Button } from '@/components/ui/button';
import { validateMediaFile } from '../utils/validation';

export interface UploadDropzoneProps {
  onUpload: (files: File[]) => void;
  disabled?: boolean;
}

export function UploadDropzone({ onUpload, disabled = false }: UploadDropzoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!disabled) {
      setIsDragging(true);
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    if (disabled) return;

    const files = Array.from(e.dataTransfer.files);
    handleFiles(files);
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files ? Array.from(e.target.files) : [];
    handleFiles(files);

    // Reset input so the same file can be selected again
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleFiles = (files: File[]) => {
    if (files.length === 0) return;

    // Validate all files
    const validFiles: File[] = [];
    const errors: string[] = [];

    for (const file of files) {
      const validation = validateMediaFile(file);
      if (validation.valid) {
        validFiles.push(file);
      } else {
        errors.push(`${file.name}: ${validation.error}`);
      }
    }

    // Show errors if any
    if (errors.length > 0) {
      logger.error('File validation errors:', errors);
      toast.error('Some files were rejected', { description: errors.join(', ') });
    }

    // Upload valid files
    if (validFiles.length > 0) {
      onUpload(validFiles);
    }
  };

  const handleClick = () => {
    if (!disabled) {
      fileInputRef.current?.click();
    }
  };

  return (
    <div
      className={`
        relative border-2 border-dashed rounded-lg transition-all duration-300
        ${isDragging
          ? 'border-primary bg-gradient-to-br from-primary/10 via-transparent to-primary/5 scale-[0.99]'
          : 'border-border hover:border-primary/50 bg-secondary/30'
        }
        ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:bg-secondary/50'}
      `}
      style={{
        boxShadow: isDragging ? '0 0 30px oklch(var(--primary) / 0.15)' : undefined,
      }}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onClick={handleClick}
    >
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="video/*,audio/*,image/*"
        onChange={handleFileInputChange}
        disabled={disabled}
        className="hidden"
      />

      {/* Animated corner accents */}
      <div className={`absolute top-2 left-2 w-6 h-6 border-l-2 border-t-2 transition-all duration-300 ${isDragging ? 'border-primary' : 'border-border'}`} />
      <div className={`absolute top-2 right-2 w-6 h-6 border-r-2 border-t-2 transition-all duration-300 ${isDragging ? 'border-primary' : 'border-border'}`} />
      <div className={`absolute bottom-2 left-2 w-6 h-6 border-l-2 border-b-2 transition-all duration-300 ${isDragging ? 'border-primary' : 'border-border'}`} />
      <div className={`absolute bottom-2 right-2 w-6 h-6 border-r-2 border-b-2 transition-all duration-300 ${isDragging ? 'border-primary' : 'border-border'}`} />

      <div className="flex flex-col items-center justify-center py-10 px-6">
        {/* Animated upload icon */}
        <div
          className={`
            w-16 h-16 rounded-full flex items-center justify-center mb-4
            transition-all duration-300 border-2
            ${isDragging
              ? 'bg-primary/20 border-primary scale-110'
              : 'bg-secondary border-border hover:border-primary/50'
            }
          `}
        >
          <Upload
            className={`w-7 h-7 transition-all duration-300 ${
              isDragging ? 'text-primary animate-bounce' : 'text-muted-foreground'
            }`}
          />
        </div>

        <p className={`text-base font-bold tracking-wide mb-2 transition-colors ${
          isDragging ? 'text-primary' : 'text-foreground'
        }`}>
          {isDragging ? 'DROP FILES HERE' : 'IMPORT MEDIA'}
        </p>

        <p className="text-sm text-muted-foreground text-center mb-3 font-light">
          Drag and drop files or click to browse
        </p>

        {/* Supported formats */}
        <div className="flex flex-wrap justify-center gap-2 mt-2">
          <span className="px-2 py-0.5 bg-secondary border border-border rounded text-xs font-mono text-muted-foreground">MP4</span>
          <span className="px-2 py-0.5 bg-secondary border border-border rounded text-xs font-mono text-muted-foreground">WebM</span>
          <span className="px-2 py-0.5 bg-secondary border border-border rounded text-xs font-mono text-muted-foreground">MOV</span>
          <span className="px-2 py-0.5 bg-secondary border border-border rounded text-xs font-mono text-muted-foreground">MP3</span>
          <span className="px-2 py-0.5 bg-secondary border border-border rounded text-xs font-mono text-muted-foreground">WAV</span>
          <span className="px-2 py-0.5 bg-secondary border border-border rounded text-xs font-mono text-muted-foreground">JPG</span>
          <span className="px-2 py-0.5 bg-secondary border border-border rounded text-xs font-mono text-muted-foreground">PNG</span>
          <span className="px-2 py-0.5 bg-secondary border border-border rounded text-xs font-mono text-muted-foreground">WebP</span>
        </div>
      </div>

      {/* Animated scan line effect when dragging */}
      {isDragging && (
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute inset-x-0 h-px bg-gradient-to-r from-transparent via-primary to-transparent animate-scan" />
        </div>
      )}
    </div>
  );
}
