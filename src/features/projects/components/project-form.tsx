import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Link } from '@tanstack/react-router';
import {
  projectFormSchema,
  type ProjectFormData,
  type ProjectTemplate,
  DEFAULT_PROJECT_VALUES,
  FPS_PRESETS,
  PROJECT_TEMPLATES,
} from '../utils/validation';
import { ProjectTemplatePicker } from './project-template-picker';

interface ProjectFormProps {
  onSubmit: (data: ProjectFormData) => Promise<void> | void;
  onCancel?: () => void;
  defaultValues?: Partial<ProjectFormData>;
  isEditing?: boolean;
  isSubmitting?: boolean;
  hideHeader?: boolean;
}

export function ProjectForm({
  onSubmit,
  onCancel,
  defaultValues,
  isEditing = false,
  isSubmitting = false,
  hideHeader = false,
}: ProjectFormProps) {
  const {
    register,
    handleSubmit,
    formState: { errors, isValid },
    watch,
    setValue,
  } = useForm<ProjectFormData>({
    resolver: zodResolver(projectFormSchema),
    defaultValues: defaultValues || DEFAULT_PROJECT_VALUES,
    mode: 'onChange',
  });

  const matchTemplateId = (width: number, height: number) =>
    PROJECT_TEMPLATES.find((t) => t.width === width && t.height === height)?.id ?? 'custom';

  const [selectedTemplateId, setSelectedTemplateId] = useState<string | undefined>(() =>
    matchTemplateId(
      defaultValues?.width ?? DEFAULT_PROJECT_VALUES.width,
      defaultValues?.height ?? DEFAULT_PROJECT_VALUES.height
    )
  );

  useEffect(() => {
    setSelectedTemplateId(
      matchTemplateId(
        defaultValues?.width ?? DEFAULT_PROJECT_VALUES.width,
        defaultValues?.height ?? DEFAULT_PROJECT_VALUES.height
      )
    );
  }, [defaultValues?.width, defaultValues?.height]);

  const fps = watch('fps');

  const handleSelectTemplate = (template: ProjectTemplate) => {
    setSelectedTemplateId(template.id);
    setValue('width', template.width, { shouldValidate: true });
    setValue('height', template.height, { shouldValidate: true });
    setValue('fps', template.fps, { shouldValidate: true });
  };

  const handleCustomSelect = () => {
    setSelectedTemplateId('custom');
  };

  return (
    <div className="bg-background">
      {/* Header */}
      {!hideHeader && (
        <div className="panel-header border-b border-border">
          <div className="max-w-3xl mx-auto px-6 py-5">
            <h1 className="text-2xl font-semibold tracking-tight text-foreground mb-1">
              {isEditing ? 'Edit Project' : 'Create New Project'}
            </h1>
            <p className="text-sm text-muted-foreground">
              {isEditing
                ? 'Update your project settings'
                : 'Set up your video editing workspace'}
            </p>
          </div>
        </div>
      )}

      {/* Form */}
      <div className="max-w-3xl mx-auto px-6 py-8">
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-8">
          {/* Project Details */}
          <div className="panel-bg border border-border rounded-lg p-6">
            <div className="flex items-center gap-3 mb-6">
              <div className="h-8 w-1 bg-primary rounded-full" />
              <h2 className="text-lg font-medium text-foreground">Project Details</h2>
            </div>

            <div className="space-y-5">
              {/* Project Name */}
              <div>
                <label htmlFor="name" className="block text-sm font-medium text-foreground mb-2">
                  Project Name <span className="text-destructive">*</span>
                </label>
                <input
                  id="name"
                  type="text"
                  {...register('name')}
                  className="w-full px-3 py-2 bg-secondary border border-input rounded-md text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent transition-all"
                  placeholder="Enter project name..."
                />
                {errors.name && (
                  <p className="mt-1.5 text-sm text-destructive">{errors.name.message}</p>
                )}
              </div>

              {/* Description */}
              <div>
                <label
                  htmlFor="description"
                  className="block text-sm font-medium text-foreground mb-2"
                >
                  Description
                </label>
                <textarea
                  id="description"
                  rows={3}
                  {...register('description')}
                  className="w-full px-3 py-2 bg-secondary border border-input rounded-md text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent transition-all resize-none"
                  placeholder="Brief description of your project..."
                />
                {errors.description && (
                  <p className="mt-1.5 text-sm text-destructive">{errors.description.message}</p>
                )}
              </div>
            </div>
          </div>

          <Separator />

           {/* Video Settings */}
           <div className="panel-bg border border-border rounded-lg p-6">
             <div className="flex items-center gap-3 mb-6">
               <div className="h-8 w-1 bg-primary rounded-full" />
               <h2 className="text-lg font-medium text-foreground">Video Settings</h2>
             </div>

             <div className="space-y-6">
               {/* Resolution — visual template picker */}
               <div>
                 <p className="text-sm font-medium text-foreground mb-3">Resolution</p>
                 <ProjectTemplatePicker
                   selectedTemplateId={selectedTemplateId === 'custom' ? undefined : selectedTemplateId}
                   onSelectTemplate={handleSelectTemplate}
                   onSelectCustom={handleCustomSelect}
                   isCustomSelected={selectedTemplateId === 'custom'}
                 />
                 {selectedTemplateId === 'custom' && (
                   <div className="mt-4 flex items-center gap-3">
                     <div className="flex-1">
                       <label htmlFor="width" className="block text-xs font-medium text-muted-foreground mb-1">Width (px)</label>
                       <input
                         id="width"
                         type="number"
                         {...register('width', { valueAsNumber: true })}
                         className="w-full px-3 py-2 bg-secondary border border-input rounded-md text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent transition-all"
                          placeholder="1920"
                          min={320}
                        />
                        {errors.width && <p className="mt-1 text-xs text-destructive">{errors.width.message}</p>}
                      </div>
                      <span className="text-muted-foreground mt-4">×</span>
                      <div className="flex-1">
                        <label htmlFor="height" className="block text-xs font-medium text-muted-foreground mb-1">Height (px)</label>
                        <input
                          id="height"
                          type="number"
                          {...register('height', { valueAsNumber: true })}
                          className="w-full px-3 py-2 bg-secondary border border-input rounded-md text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent transition-all"
                          placeholder="1080"
                          min={240}
                        />
                       {errors.height && <p className="mt-1 text-xs text-destructive">{errors.height.message}</p>}
                     </div>
                   </div>
                 )}
               </div>

               {/* Frame Rate */}
               <div>
                 <label htmlFor="fps" className="block text-sm font-medium text-foreground mb-2">
                   Frame Rate
                 </label>
                 <Select
                   value={fps.toString()}
                   onValueChange={(value) => setValue('fps', Number(value), { shouldValidate: true })}
                 >
                   <SelectTrigger id="fps">
                     <SelectValue />
                   </SelectTrigger>
                   <SelectContent>
                     {FPS_PRESETS.map((preset) => (
                       <SelectItem key={preset.value} value={preset.value.toString()}>
                         {preset.label}
                       </SelectItem>
                     ))}
                   </SelectContent>
                 </Select>
                 {errors.fps && (
                   <p className="mt-1.5 text-sm text-destructive">{errors.fps.message}</p>
                 )}
               </div>
             </div>
           </div>

           {/* Actions */}
          <div className="flex gap-3 justify-end">
            {onCancel ? (
              <Button type="button" variant="outline" size="lg" disabled={isSubmitting} onClick={onCancel}>
                Cancel
              </Button>
            ) : (
              <Link to="/projects">
                <Button type="button" variant="outline" size="lg" disabled={isSubmitting}>
                  Cancel
                </Button>
              </Link>
            )}
            <Button type="submit" size="lg" className="min-w-[160px]" disabled={!isValid || isSubmitting}>
              {isSubmitting ? 'Saving...' : isEditing ? 'Update Project' : 'Create Project'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
