import { Plus } from 'lucide-react';
import { PROJECT_TEMPLATES, getAspectRatio, type ProjectTemplate } from '../utils/validation';

interface ProjectTemplatePickerProps {
  onSelectTemplate: (template: ProjectTemplate) => void;
  selectedTemplateId?: string;
  onSelectCustom?: () => void;
  isCustomSelected?: boolean;
}

export function ProjectTemplatePicker({
  onSelectTemplate,
  selectedTemplateId,
  onSelectCustom,
  isCustomSelected,
}: ProjectTemplatePickerProps) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
       {PROJECT_TEMPLATES.map((template) => {
         const isSelected = selectedTemplateId === template.id;
         const aspectRatio = getAspectRatio(template.width, template.height);
         const resolution = `${template.width}×${template.height}`;

         return (
           <button
             key={template.id}
             type="button"
             aria-pressed={isSelected}
             onClick={() => onSelectTemplate(template)}
             className={`group relative flex flex-col gap-3 p-4 panel-bg border rounded-lg transition-all hover:border-primary/50 hover:shadow-lg hover:shadow-primary/5 ${
               isSelected
                 ? 'border-primary ring-2 ring-primary/30'
                 : 'border-border'
             }`}
           >
             {/* Silhouette Container */}
             <div className="relative h-24 bg-secondary/30 rounded overflow-hidden flex items-center justify-center">
               {/* Aspect Ratio Silhouette */}
               <div
                 className={`bg-primary/20 border-2 border-dashed rounded-sm ${
                   isSelected ? 'border-primary' : 'border-primary/40'
                 }`}
                 style={{
                   aspectRatio: `${template.width} / ${template.height}`,
                   height: '100%',
                   maxWidth: '100%',
                 }}
               />
             </div>

             {/* Template Info */}
             <div className="flex-1 text-left">
               <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                 {template.platform}
               </p>
               <h3 className="font-medium text-sm text-foreground group-hover:text-primary transition-colors mt-1">
                 {template.name}
               </h3>
               <p className="text-xs text-muted-foreground mt-2">
                 {resolution}
                 <span className="mx-1">•</span>
                 {aspectRatio}
               </p>
             </div>
           </button>
         );
       })}
       {onSelectCustom && (
          <button
            type="button"
            aria-pressed={isCustomSelected}
            onClick={onSelectCustom}
            className={`group relative flex flex-col gap-3 p-4 panel-bg border rounded-lg transition-all hover:border-primary/50 hover:shadow-lg hover:shadow-primary/5 ${
              isCustomSelected ? 'border-primary ring-2 ring-primary/30' : 'border-border'
            }`}
          >
           <div className="relative h-24 bg-secondary/30 rounded overflow-hidden flex items-center justify-center">
             <div
               className={`border-2 border-dashed rounded-sm transition-colors ${
                 isCustomSelected ? 'border-primary/70 bg-primary/10' : 'border-muted-foreground/30 bg-muted/10'
               }`}
               style={{ aspectRatio: '4 / 3', height: '80%', maxWidth: '80%' }}
             />
             <Plus
               className={`absolute w-5 h-5 transition-colors ${
                 isCustomSelected ? 'text-primary' : 'text-muted-foreground/60'
               }`}
             />
           </div>
           <div className="flex-1 text-left">
             <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Custom</p>
             <h3 className={`font-medium text-sm transition-colors mt-1 ${
               isCustomSelected ? 'text-primary' : 'text-foreground group-hover:text-primary'
             }`}>
               Custom Size
             </h3>
             <p className="text-xs text-muted-foreground mt-2">Enter dimensions</p>
           </div>
         </button>
       )}
    </div>
  );
}
