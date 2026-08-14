/**
 * TaskFlow - Modern Task Management Application
 * Complete CRUD, priority levels, deadlines, search, multi-filter, 
 * sorting, progress tracking, accessibility, and local storage persistence.
 */

class TaskManager {
    constructor() {
        this.tasks = this.loadTasks();
        this.currentFilter = 'all';
        this.priorityFilter = 'all';
        this.sortBy = 'created-desc';
        this.currentSearch = '';
        this.currentDeleteId = null;

        this.initTheme();
        this.initApp();
    }

    initTheme() {
        const savedTheme = localStorage.getItem('taskflow_theme') || 'light';
        document.documentElement.setAttribute('data-theme', savedTheme);
    }

    toggleTheme() {
        const currentTheme = document.documentElement.getAttribute('data-theme') || 'light';
        const newTheme = currentTheme === 'light' ? 'dark' : 'light';
        document.documentElement.setAttribute('data-theme', newTheme);
        localStorage.setItem('taskflow_theme', newTheme);
        this.showToast(`Thème ${newTheme === 'dark' ? 'sombre' : 'clair'} activé`, 'info');
    }

    initApp() {
        // DOM Elements
        this.taskForm = document.getElementById('task-form');
        this.taskList = document.getElementById('task-list');
        this.filterSelect = document.getElementById('filter');
        this.priorityFilterSelect = document.getElementById('priority-filter');
        this.sortBySelect = document.getElementById('sort-by');
        this.searchInput = document.getElementById('search-input');
        this.clearSearchBtn = document.getElementById('clear-search');
        this.themeToggleBtn = document.getElementById('theme-toggle');

        // Progress & Stats DOM
        this.progressText = document.getElementById('progress-text');
        this.progressFill = document.getElementById('progress-fill');
        this.statTotal = document.getElementById('stat-total');
        this.statActive = document.getElementById('stat-active');
        this.statCompleted = document.getElementById('stat-completed');
        this.statOverdue = document.getElementById('stat-overdue');

        // Modals
        this.editModal = document.getElementById('edit-modal');
        this.editForm = document.getElementById('edit-form');
        this.modalCloseBtn = document.getElementById('modal-close-btn');
        this.modalCancelBtn = document.getElementById('modal-cancel-btn');

        this.deleteModal = document.getElementById('delete-modal');
        this.deleteModalClose = document.getElementById('delete-modal-close');
        this.deleteCancelBtn = document.getElementById('delete-cancel-btn');
        this.deleteConfirmBtn = document.getElementById('delete-confirm-btn');

        if (!this.taskForm || !this.taskList) {
            console.error('Required elements not found in DOM');
            return;
        }

        // Event Listeners
        this.taskForm.addEventListener('submit', (e) => this.handleFormSubmit(e));
        
        if (this.filterSelect) {
            this.filterSelect.addEventListener('change', (e) => {
                this.currentFilter = e.target.value;
                this.renderTasks();
            });
        }

        if (this.priorityFilterSelect) {
            this.priorityFilterSelect.addEventListener('change', (e) => {
                this.priorityFilter = e.target.value;
                this.renderTasks();
            });
        }

        if (this.sortBySelect) {
            this.sortBySelect.addEventListener('change', (e) => {
                this.sortBy = e.target.value;
                this.renderTasks();
            });
        }

        if (this.searchInput) {
            this.searchInput.addEventListener('input', (e) => this.handleSearchChange(e));
        }

        if (this.clearSearchBtn) {
            this.clearSearchBtn.addEventListener('click', () => {
                this.searchInput.value = '';
                this.currentSearch = '';
                this.clearSearchBtn.classList.add('hidden');
                this.renderTasks();
            });
        }

        if (this.themeToggleBtn) {
            this.themeToggleBtn.addEventListener('click', () => this.toggleTheme());
        }

        // Edit Modal listeners
        if (this.editForm) {
            this.editForm.addEventListener('submit', (e) => this.handleEditFormSubmit(e));
        }
        if (this.modalCloseBtn) {
            this.modalCloseBtn.addEventListener('click', () => this.closeEditModal());
        }
        if (this.modalCancelBtn) {
            this.modalCancelBtn.addEventListener('click', () => this.closeEditModal());
        }

        // Delete Modal listeners
        if (this.deleteModalClose) {
            this.deleteModalClose.addEventListener('click', () => this.closeDeleteModal());
        }
        if (this.deleteCancelBtn) {
            this.deleteCancelBtn.addEventListener('click', () => this.closeDeleteModal());
        }
        if (this.deleteConfirmBtn) {
            this.deleteConfirmBtn.addEventListener('click', () => this.confirmDeleteTask());
        }

        // Global ESC key for modals
        window.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this.closeEditModal();
                this.closeDeleteModal();
            }
        });

        // Initial Render & Seed
        if (this.tasks.length === 0 && !localStorage.getItem('taskflow_initialized')) {
            this.seedInitialTasks();
        }

        this.renderTasks();
        this.updateProgress();
    }

    seedInitialTasks() {
        const today = new Date();
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);
        const nextWeek = new Date(today);
        nextWeek.setDate(nextWeek.getDate() + 7);

        this.tasks = [
            {
                id: '1',
                title: 'Découvrir TaskFlow et explorer les fonctionnalités',
                description: 'Tester la création, la modification, le filtrage et la suppression de tâches.',
                priority: 'high',
                deadline: tomorrow.toISOString().split('T')[0],
                completed: false,
                createdAt: new Date(today.getTime() - 3600000).toISOString(),
                updatedAt: new Date(today.getTime() - 3600000).toISOString()
            },
            {
                id: '2',
                title: 'Organiser le sprint hebdomadaire',
                description: 'Définir les priorités et fixer les échéances de l\'équipe.',
                priority: 'medium',
                deadline: nextWeek.toISOString().split('T')[0],
                completed: true,
                createdAt: new Date(today.getTime() - 7200000).toISOString(),
                updatedAt: new Date().toISOString()
            }
        ];
        localStorage.setItem('taskflow_initialized', 'true');
        this.saveTasks();
    }

    handleSearchChange(e) {
        this.currentSearch = e.target.value.trim().toLowerCase();
        if (this.clearSearchBtn) {
            if (this.currentSearch.length > 0) {
                this.clearSearchBtn.classList.remove('hidden');
            } else {
                this.clearSearchBtn.classList.add('hidden');
            }
        }
        this.renderTasks();
    }

    handleFormSubmit(e) {
        e.preventDefault();

        const titleInput = document.getElementById('title');
        const descriptionInput = document.getElementById('description');
        const priorityInput = document.getElementById('priority');
        const deadlineInput = document.getElementById('deadline');
        const titleError = document.getElementById('title-error');

        const title = titleInput.value.trim();
        const description = descriptionInput ? descriptionInput.value.trim() : '';
        const priority = priorityInput ? priorityInput.value : 'medium';
        const deadline = deadlineInput && deadlineInput.value ? deadlineInput.value : null;

        // Validation
        if (!title) {
            if (titleError) titleError.textContent = 'Le titre est obligatoire.';
            if (titleInput) titleInput.closest('.form-group')?.classList.add('has-error');
            titleInput?.focus();
            return;
        }

        // Reset error state
        if (titleError) titleError.textContent = '';
        titleInput.closest('.form-group')?.classList.remove('has-error');

        const newTask = {
            id: Date.now().toString(),
            title,
            description,
            priority,
            deadline,
            completed: false,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        this.tasks.unshift(newTask);
        this.saveTasks();
        this.renderTasks();
        this.updateProgress();

        this.taskForm.reset();
        this.showToast('Tâche créée avec succès !', 'success');
    }

    handleCompleteTask(taskId) {
        const taskIndex = this.tasks.findIndex(t => t.id === taskId);
        if (taskIndex === -1) return;

        this.tasks[taskIndex].completed = !this.tasks[taskIndex].completed;
        this.tasks[taskIndex].updatedAt = new Date().toISOString();

        this.saveTasks();
        this.renderTasks();
        this.updateProgress();

        const statusMsg = this.tasks[taskIndex].completed ? 'Tâche marquée comme terminée' : 'Tâche marquée comme en cours';
        this.showToast(statusMsg, 'info');
    }

    openEditModal(taskId) {
        const task = this.tasks.find(t => t.id === taskId);
        if (!task || !this.editModal) return;

        document.getElementById('edit-id').value = task.id;
        document.getElementById('edit-title').value = task.title;
        document.getElementById('edit-description').value = task.description || '';
        document.getElementById('edit-priority').value = task.priority;
        document.getElementById('edit-deadline').value = task.deadline || '';
        document.getElementById('edit-completed').checked = task.completed;

        const editTitleError = document.getElementById('edit-title-error');
        if (editTitleError) editTitleError.textContent = '';

        this.editModal.classList.remove('hidden');
        document.getElementById('edit-title')?.focus();
    }

    closeEditModal() {
        if (this.editModal) {
            this.editModal.classList.add('hidden');
        }
    }

    handleEditFormSubmit(e) {
        e.preventDefault();

        const id = document.getElementById('edit-id').value;
        const titleInput = document.getElementById('edit-title');
        const descriptionInput = document.getElementById('edit-description');
        const priorityInput = document.getElementById('edit-priority');
        const deadlineInput = document.getElementById('edit-deadline');
        const completedInput = document.getElementById('edit-completed');
        const titleError = document.getElementById('edit-title-error');

        const title = titleInput.value.trim();
        if (!title) {
            if (titleError) titleError.textContent = 'Le titre ne peut pas être vide.';
            titleInput.focus();
            return;
        }

        const taskIndex = this.tasks.findIndex(t => t.id === id);
        if (taskIndex !== -1) {
            this.tasks[taskIndex].title = title;
            this.tasks[taskIndex].description = descriptionInput.value.trim();
            this.tasks[taskIndex].priority = priorityInput.value;
            this.tasks[taskIndex].deadline = deadlineInput.value || null;
            this.tasks[taskIndex].completed = completedInput.checked;
            this.tasks[taskIndex].updatedAt = new Date().toISOString();

            this.saveTasks();
            this.renderTasks();
            this.updateProgress();
            this.closeEditModal();
            this.showToast('Tâche mise à jour !', 'success');
        }
    }

    openDeleteModal(taskId) {
        const task = this.tasks.find(t => t.id === taskId);
        if (!task || !this.deleteModal) return;

        this.currentDeleteId = taskId;
        const previewEl = document.getElementById('delete-task-title-preview');
        if (previewEl) previewEl.textContent = `« ${task.title} »`;

        this.deleteModal.classList.remove('hidden');
    }

    closeDeleteModal() {
        if (this.deleteModal) {
            this.deleteModal.classList.add('hidden');
            this.currentDeleteId = null;
        }
    }

    confirmDeleteTask() {
        if (!this.currentDeleteId) return;

        this.tasks = this.tasks.filter(t => t.id !== this.currentDeleteId);
        this.saveTasks();
        this.renderTasks();
        this.updateProgress();
        this.closeDeleteModal();
        this.showToast('Tâche supprimée', 'info');
    }

    // Direct delete fallback if needed
    handleDeleteTask(taskId) {
        this.openDeleteModal(taskId);
    }

    // Direct edit fallback if prompt used in legacy tests
    handleEditTask(taskId) {
        this.openEditModal(taskId);
    }

    renderTasks() {
        const filteredTasks = this.tasks.filter(task => {
            // Status filter
            const matchesStatus = this.currentFilter === 'all'
                ? true
                : this.currentFilter === 'completed'
                    ? task.completed
                    : !task.completed;

            // Priority filter
            const matchesPriority = this.priorityFilter === 'all'
                ? true
                : task.priority === this.priorityFilter;

            // Search filter
            const matchesSearch = this.currentSearch === ''
                ? true
                : task.title.toLowerCase().includes(this.currentSearch) ||
                  (task.description && task.description.toLowerCase().includes(this.currentSearch));

            return matchesStatus && matchesPriority && matchesSearch;
        });

        // Sorting
        filteredTasks.sort((a, b) => {
            if (this.sortBy === 'created-desc') {
                return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
            }
            if (this.sortBy === 'deadline-asc') {
                if (!a.deadline) return 1;
                if (!b.deadline) return -1;
                return new Date(a.deadline) - new Date(b.deadline);
            }
            if (this.sortBy === 'priority-desc') {
                const pWeights = { high: 3, medium: 2, low: 1 };
                return (pWeights[b.priority] || 0) - (pWeights[a.priority] || 0);
            }
            if (this.sortBy === 'title-asc') {
                return a.title.localeCompare(b.title);
            }
            return 0;
        });

        this.taskList.innerHTML = '';

        if (filteredTasks.length === 0) {
            const searchTerm = this.currentSearch ? ` matching "${this.currentSearch}"` : '';
            this.taskList.innerHTML = `
                <div class="empty-state" role="status" aria-live="polite">
                    <div class="empty-icon" aria-hidden="true">🔍</div>
                    <h3>Aucune tâche trouvée</h3>
                    <p>Aucune tâche ne correspond à vos critères de recherche ou de filtrage${searchTerm}.</p>
                </div>
            `;
            return;
        }

        filteredTasks.forEach(task => {
            const cardEl = this.createTaskCard(task);
            this.taskList.appendChild(cardEl);
        });
    }

    createTaskCard(task) {
        const isCompleted = task.completed;
        const hasDeadline = Boolean(task.deadline);
        const todayStr = new Date().toISOString().split('T')[0];
        const isOverdue = !isCompleted && hasDeadline && task.deadline < todayStr;
        const isToday = !isCompleted && hasDeadline && task.deadline === todayStr;

        const card = document.createElement('div');
        // Include both 'task-card' and 'task-card-item' for backwards testing compatibility
        card.className = `task-card task-card-item priority-${task.priority} ${isCompleted ? 'completed' : ''}`;
        card.dataset.id = task.id;

        // Priority text formatting
        const priorityLabels = { high: '🔴 Haute', medium: '🟡 Moyenne', low: '🟢 Basse' };
        const priorityText = priorityLabels[task.priority] || task.priority;

        // Deadline formatting
        let deadlineMarkup = '';
        if (hasDeadline) {
            const dateObj = new Date(task.deadline + 'T00:00:00');
            const formattedDate = dateObj.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
            
            let deadlineClass = 'badge-deadline';
            if (isOverdue) deadlineClass += ' overdue';
            else if (isToday) deadlineClass += ' due-soon';

            deadlineMarkup = `<span class="badge ${deadlineClass}">
                📅 ${isOverdue ? 'En retard : ' : ''}${formattedDate}
            </span>`;
        } else {
            deadlineMarkup = `<span class="badge badge-deadline">📅 Pas d'échéance</span>`;
        }

        card.innerHTML = `
            <div class="task-header-row">
                <div class="task-title-wrapper">
                    <input type="checkbox" class="checkbox-toggle" ${isCompleted ? 'checked' : ''} 
                        aria-label="${isCompleted ? 'Marquer comme non terminée' : 'Marquer comme terminée'}">
                    <h3 class="task-title task-title-text">${this.escapeHtml(task.title)}</h3>
                </div>
                <div class="task-actions">
                    <button type="button" class="action-btn btn-edit-item btn-edit" data-id="${task.id}" aria-label="Modifier la tâche" title="Modifier">
                        ✏️
                    </button>
                    <button type="button" class="action-btn btn-complete-item btn-complete" data-id="${task.id}" aria-label="Changer le statut" title="Statut">
                        ${isCompleted ? '↺' : '✓'}
                    </button>
                    <button type="button" class="action-btn btn-delete-item btn-delete" data-id="${task.id}" aria-label="Supprimer la tâche" title="Supprimer">
                        🗑️
                    </button>
                </div>
            </div>

            ${task.description ? `<div class="task-body">${this.escapeHtml(task.description)}</div>` : ''}

            <div class="task-meta-row">
                <span class="badge badge-priority ${task.priority}">
                    ${priorityText}
                </span>
                ${deadlineMarkup}
            </div>
        `;

        // Event listeners
        const checkbox = card.querySelector('.checkbox-toggle');
        const editBtn = card.querySelector('.btn-edit-item');
        const completeBtn = card.querySelector('.btn-complete-item');
        const deleteBtn = card.querySelector('.btn-delete-item');

        checkbox.addEventListener('change', () => this.handleCompleteTask(task.id));
        editBtn.addEventListener('click', () => this.openEditModal(task.id));
        completeBtn.addEventListener('click', () => this.handleCompleteTask(task.id));
        deleteBtn.addEventListener('click', () => this.openDeleteModal(task.id));

        return card;
    }

    updateProgress() {
        const total = this.tasks.length;
        const completed = this.tasks.filter(t => t.completed).length;
        const active = total - completed;
        
        const todayStr = new Date().toISOString().split('T')[0];
        const overdue = this.tasks.filter(t => !t.completed && t.deadline && t.deadline < todayStr).length;

        const percentage = total > 0 ? Math.round((completed / total) * 100) : 0;

        // Update Stat Cards
        if (this.statTotal) this.statTotal.textContent = total;
        if (this.statActive) this.statActive.textContent = active;
        if (this.statCompleted) this.statCompleted.textContent = completed;
        if (this.statOverdue) this.statOverdue.textContent = overdue;

        // Update Progress Bar
        if (this.progressText) {
            this.progressText.textContent = `${percentage}% (${completed}/${total} complétées)`;
        }
        if (this.progressFill) {
            this.progressFill.style.width = `${percentage}%`;
        }

        const progressBarTrack = document.getElementById('progress-bar');
        if (progressBarTrack) {
            progressBarTrack.setAttribute('aria-valuenow', percentage);
        }

        return percentage;
    }

    showToast(message, type = 'info') {
        const container = document.getElementById('toast-container');
        if (!container) return;

        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        
        const icons = { success: '✅', error: '❌', info: 'ℹ️' };
        toast.innerHTML = `<span>${icons[type] || 'ℹ️'}</span> <span>${this.escapeHtml(message)}</span>`;

        container.appendChild(toast);

        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateY(10px)';
            toast.style.transition = 'all 0.2s ease';
            setTimeout(() => toast.remove(), 200);
        }, 3000);
    }

    saveTasks() {
        try {
            localStorage.setItem('tasks', JSON.stringify(this.tasks));
        } catch (e) {
            console.error('Failed to save tasks to localStorage:', e);
        }
    }

    loadTasks() {
        try {
            const saved = localStorage.getItem('tasks');
            return saved ? JSON.parse(saved) : [];
        } catch (e) {
            console.error('Failed to load tasks from localStorage:', e);
            return [];
        }
    }

    escapeHtml(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }
}

// Global instance export for testing and DOM initialization
let appInstance = null;

document.addEventListener('DOMContentLoaded', () => {
    appInstance = new TaskManager();
});

// Export TaskManager if running in Node environment (for Jest/testing)
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { TaskManager };
}