import { useState, useEffect } from 'react';
import { X, Loader2, Save, PlusCircle, List  } from 'lucide-react';
import { GATEWAY_URL } from '../../constants';
import { DynamicArrayInput } from './DynamicArrayInput';
import CodeMirror from '@uiw/react-codemirror';
import { python } from '@codemirror/lang-python';
import { dracula } from '@uiw/codemirror-theme-dracula';

interface QuestionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (updatedData?: any) => void;
  mode: 'add' | 'edit';
  initialData?: any;
}

export function QuestionModal({ isOpen, onClose, onSuccess, mode, initialData }: QuestionModalProps) {
  const [formData, setFormData] = useState({
    title: '',
    topic: 'Arrays',
    difficulty: 'Easy',
    statement: '',
    template: '',
    examples: [''],
    constraints: [''],
    hints: ['']
  });
  
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [existingTopics, setExistingTopics] = useState<string[]>([]);
  const [isCreatingNewTopic, setIsCreatingNewTopic] = useState(false);
  const [newTopicInput, setNewTopicInput] = useState('');
  const [isLoadingTopics, setIsLoadingTopics] = useState(false);
  const [initialRef, setInitialRef] = useState(JSON.stringify(formData));

  // Sync state when opening
  useEffect(() => {
    const fetchTopics = async () => {
      setIsLoadingTopics(true);
      try {
        const token = localStorage.getItem('peerprep_token'); 
        const response = await fetch(`${GATEWAY_URL}/question/topics`, {
          headers: { 
            'Authorization': `Bearer ${token}` 
          }
        });
        if (response.ok) {
          const data = await response.json();
          let updatedTopics = [...data];

          
          if (mode === 'edit' && initialData?.topic && !updatedTopics.includes(initialData.topic)) {
            updatedTopics.push(initialData.topic);
          }

          const sortedTopics = updatedTopics.sort((a, b) => a.localeCompare(b));
          setExistingTopics(sortedTopics);

          if (mode === 'add' && sortedTopics.length > 0) {
            setFormData(prev => ({ ...prev, topic: sortedTopics[0] }));
          }
        }
      } catch (err) {
        console.error("Failed to fetch topics:", err);
        setExistingTopics([]); 
      } finally {
        setIsLoadingTopics(false);
      }
    };

    if (isOpen) fetchTopics();
  }, [isOpen, mode, initialData?.topic]);

 
  useEffect(() => {
    if (isOpen) {
        const dataToLoad = (mode === 'edit' && initialData) ? initialData : {
        title: '', topic: existingTopics[0] || 'Arrays', difficulty: 'Easy',
        statement: '', template: '', examples: [''],
        constraints: [''], hints: ['']
        };
        setFormData(dataToLoad);
        setInitialRef(JSON.stringify(dataToLoad));
    }
    }, [isOpen, mode, initialData, existingTopics]);

    const hasUnsavedChanges = JSON.stringify(formData) !== initialRef || (isCreatingNewTopic && newTopicInput !== '');

    const handleCloseAttempt = () => {
    if (hasUnsavedChanges) {
        if (window.confirm("You have unsaved changes. Are you sure you want to discard them?")) {
        onClose();
        }
    } else {
        onClose();
    }
    };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const finalData = {
      ...formData,
      topic: isCreatingNewTopic ? newTopicInput.trim() : formData.topic
    };

    if (isCreatingNewTopic && !newTopicInput.trim()) { // prevent the admin from creating a new topic with an empty name (using a space to bypass the default value check)
      alert("Please enter a name for the new topic");
      return;
    }
    setIsSubmitting(true);
    try {
      const token = localStorage.getItem('peerprep_token');
      const url = mode === 'add' 
        ? `${GATEWAY_URL}/question/` 
        : `${GATEWAY_URL}/question/${initialData.question_id}`;
      
      const response = await fetch(url, {
        method: mode === 'add' ? 'POST' : 'PUT',
        headers: { 
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(finalData)
      });

      if (!response.ok) throw new Error(`Failed to ${mode} question`);
      
      const savedData = await response.json();
      onSuccess(savedData);
      onClose();
    } catch (err: any) {
      alert(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-md flex items-center justify-center p-6 z-[100]">
      <div className="bg-[#4A4563] rounded-[32px] w-full max-w-3xl max-h-[90vh] overflow-y-auto p-10 relative custom-scrollbar border border-white/10 shadow-2xl">
        <button onClick={handleCloseAttempt} className="absolute top-6 right-6 text-gray-400 hover:text-white transition-colors">
          <X className="w-8 h-8" />
        </button>
        
        <h2 className="text-white font-bold text-3xl mb-8 flex items-center gap-3">
          {mode === 'add' ? 'Add New Question' : `Edit Question #${initialData.question_id}`}
        </h2>
        
        <form onSubmit={handleSubmit} className="space-y-8">
          {/* Basic Info Group */}
          <div className="grid md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <label className="text-[#E8B995] text-xs font-bold uppercase tracking-widest ml-1">Title</label>
              <input 
                required
                value={formData.title}
                onChange={(e) => setFormData({...formData, title: e.target.value})}
                placeholder="e.g. Longest Palindromic Substring"
                className="input-field w-full bg-[#3A3552]"
              />
            </div>
            <div className="space-y-2">
            <div className="flex justify-between items-center">
                <label className="text-[#E8B995] text-xs font-bold uppercase tracking-widest ml-1">Topic</label>
                <button 
                type="button"
                onClick={() => setIsCreatingNewTopic(!isCreatingNewTopic)}
                className="text-[#E8B995] text-[10px] font-bold uppercase flex items-center gap-1 hover:underline"
                >
                {isCreatingNewTopic ? (
                    <><List className="w-3 h-3" /> Select Existing</>
                ) : (
                    <><PlusCircle className="w-3 h-3" /> Create New Topic</>
                )}
                </button>
            </div>

            {isCreatingNewTopic ? (
                <input 
                required
                autoFocus
                value={newTopicInput}
                onChange={(e) => setNewTopicInput(e.target.value)}
                placeholder="Enter new topic name..."
                className="input-field w-full bg-[#3A3552] border-[#E8B995]/50 focus:border-[#E8B995]"
                />
            ) : (
                <div className="relative">
                <select 
                    value={formData.topic}
                    onChange={(e) => setFormData({...formData, topic: e.target.value})}
                    disabled={isLoadingTopics}
                    className="input-field w-full bg-[#3A3552] appearance-none"
                >
                    {isLoadingTopics ? (
                    <option>Loading topics...</option>
                    ) : (
                    existingTopics.map(t => (
                        <option key={t} value={t}>{t}</option>
                    ))
                    )}
                </select>
                <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-4 text-gray-400">
                    <svg className="fill-current h-4 w-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z"/></svg>
                </div>
                </div>
            )}
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-[#E8B995] text-xs font-bold uppercase tracking-widest ml-1">Difficulty</label>
            <div className="flex gap-4">
              {['Easy', 'Medium', 'Hard'].map((diff) => (
                <button
                  key={diff}
                  type="button"
                  onClick={() => setFormData({...formData, difficulty: diff})}
                  className={`flex-1 py-3 rounded-2xl font-bold transition-all border-2 ${
                    formData.difficulty === diff 
                    ? 'bg-[#E8B995] text-[#4A4563] border-[#E8B995]' 
                    : 'bg-transparent text-white border-white/10 hover:border-white/30'
                  }`}
                >
                  {diff}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-[#E8B995] text-xs font-bold uppercase tracking-widest ml-1">Problem Statement (Markdown)</label>
            <textarea 
              required
              rows={6}
              value={formData.statement}
              onChange={(e) => setFormData({...formData, statement: e.target.value})}
              placeholder="Use Markdown to describe the problem..."
              className="input-field w-full bg-[#3A3552] rounded-[24px] resize-none"
            />
          </div>

          <div className="space-y-2">
            <label className="text-[#E8B995] text-xs font-bold uppercase tracking-widest ml-1">Python Template</label>
            <div className="rounded-[24px] overflow-hidden border-2 border-white/5">
              <CodeMirror
                value={formData.template}
                minHeight="200px"
                theme={dracula}
                extensions={[python()]}
                onChange={(value) => setFormData({ ...formData, template: value })}
              />
            </div>
          </div>

          <div className="space-y-10 border-y border-white/5 py-8">
            <DynamicArrayInput 
              label="Examples" 
              items={formData.examples} 
              isEditing={true}
              onUpdate={(val) => setFormData({...formData, examples: val})} 
            />
            <DynamicArrayInput 
              label="Constraints" 
              items={formData.constraints} 
              isEditing={true}
              onUpdate={(val) => setFormData({...formData, constraints: val})} 
            />
            <DynamicArrayInput 
              label="Hints" 
              items={formData.hints} 
              isEditing={true}
              onUpdate={(val) => setFormData({...formData, hints: val})} 
            />
          </div>

          {/* Action Buttons: Save or Discard */}
          <div className="flex gap-4  bottom-0 bg-[#4A4563] pt-4 pb-2">
            <button 
              type="button"
              onClick={handleCloseAttempt}
              className="flex-1 px-6 py-4 rounded-2xl font-bold text-gray-300 bg-white/5 hover:bg-white/10 transition-all"
            >
              Discard
            </button>
            <button 
              type="submit" 
              disabled={isSubmitting}
              className="flex-1 btn-secondary py-4 text-lg flex items-center justify-center gap-2"
            >
              {isSubmitting ? <Loader2 className="w-6 h-6 animate-spin" /> : <Save className="w-6 h-6" />}
              {mode === 'add' ? 'Create Question' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}