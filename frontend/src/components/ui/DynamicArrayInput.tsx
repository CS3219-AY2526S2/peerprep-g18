import React from 'react';
import { Plus, X } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';

interface DynamicArrayInputProps {
  label: string;
  items: string[];
  onUpdate: (newItems: string[]) => void;
  minRows?: number;
  isEditing?: boolean;
}

export function DynamicArrayInput({label, items, onUpdate, minRows = 2, isEditing = true }: DynamicArrayInputProps) {
  const handleAdd = () => onUpdate([...items, '']);
  const handleRemove = (index: number) => onUpdate(items.filter((_, i) => i !== index));
  const handleChange = (index: number, value: string) => {
    const newItems = [...items];
    newItems[index] = value;
    onUpdate(newItems);
  };

  return (
    <div className="space-y-3">
      <div className="flex justify-between items-center ml-2">
        <label className="text-gray-400 text-xs font-bold uppercase tracking-wider">{label}</label>
        {isEditing && (
          <button 
            type="button" 
            onClick={handleAdd} 
            className="bg-[#E8B995]/10 text-[#E8B995] hover:bg-[#E8B995] hover:text-[#4A4563] p-1.5 rounded-lg transition-all"
          >
            <Plus className="w-4 h-4" />
          </button>
        )}
      </div>
      <div className="space-y-4">
        {items.map((item, idx) => (
          <div key={idx} className="flex gap-3 items-start animate-in fade-in slide-in-from-left-2">
            <div className="relative flex-1">
              <span className="absolute left-4 top-3 text-[#E8B995] font-mono text-xs z-10">
                {idx + 1}.
              </span>
              
              {isEditing ? (
                <textarea 
                  rows={minRows}
                  className="input-field w-full pl-10 pt-2 text-sm bg-[#3A3552] resize-none whitespace-pre-wrap break-words" 
                  value={item} 
                  onChange={(e) => handleChange(idx, e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && e.stopPropagation()}
                />
              ) : (
                <div className="w-full pl-10 pr-6 py-3 bg-[#2D2942]/40 rounded-2xl border border-white/5 overflow-hidden">
                  <div className="prose prose-invert max-w-none text-sm text-white">
                    <ReactMarkdown 
                      remarkPlugins={[remarkMath]} 
                      rehypePlugins={[rehypeKatex]}
                      components={{
                        ol: ({node, ...props}) => <ol className="list-decimal pl-4 mb-2" {...props} />,
                        ul: ({node, ...props}) => <ul className="list-disc pl-4 mb-2" {...props} />,
                        li: ({node, ...props}) => <li className="mb-1" {...props} />,
                        p: ({node, ...props}) => <p className="leading-relaxed break-words whitespace-pre-wrap" {...props} />,
                        code: ({node, ...props}) => <code className="bg-[#3A3552] px-1 rounded text-[#E8B995]" {...props} />
                      }}
                    >
                      {item || "*No content provided.*"}
                    </ReactMarkdown>
                  </div>
                </div>
              )}
            </div>
            
            {isEditing && idx > 0 && (
              <button 
                type="button"
                onClick={() => handleRemove(idx)} 
                className="mt-1.5 text-red-400 p-2 hover:bg-red-400/10 rounded-xl transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}