/**
 * Tests for TaskFlow Application
 * Verifies core functionality: task creation, filtering, progress tracking
 */

describe('TaskFlow Application', () => {
    let taskManager;
    let tasks;

    beforeEach(() => {
        // Mock localStorage
        const mockTasks = [
            { id: '1', title: 'Test Task 1', description: 'Test description', priority: 'high', completed: false },
            { id: '2', title: 'Test Task 2', description: 'Another task', priority: 'medium', completed: true },
            { id: '3', title: 'Test Task 3', description: 'Third task', priority: 'low', completed: false }
        ];
        
        localStorage.setItem('tasks', JSON.stringify(mockTasks));
        tasks = JSON.parse(localStorage.getItem('tasks'));
        taskManager = new TaskManager();
    });

    test('should initialize with existing tasks', () => {
        expect(taskManager.tasks).toHaveLength(3);
        expect(taskManager.tasks.find(task => task.title === 'Test Task 1')).toBeDefined();
    });

    test('should create a new task', () => {
        const initialTasksCount = taskManager.tasks.length;
        
        // Simulate form submission
        document.getElementById('title').value = 'New Task';
        document.getElementById('description').value = 'New description';
        document.getElementById('priority').value = 'high';
        document.getElementById('deadline').value = '';
        
        // Trigger submit event
        const submitEvent = new Event('submit');
        document.getElementById('task-form').dispatchEvent(submitEvent);
        
        expect(taskManager.tasks).toHaveLength(initialTasksCount + 1);
        expect(taskManager.tasks.find(task => task.title === 'New Task')).toBeDefined();
    });

    test('should filter tasks by status', () => {
        // Filter to completed tasks
        taskManager.filterSelect.value = 'completed';
        taskManager.renderTasks();
        
        const completedTasks = taskManager.taskList.querySelectorAll('.task-card.completed');
        expect(completedTasks).toHaveLength(1);
        expect(completedTasks[0].querySelector('.task-title').textContent).toContain('Test Task 2');
    });

    test('should calculate progress correctly', () => {
        // With 2 completed out of 3 tasks
        expect(taskManager.updateProgress()).toBe(66); // 2/3 = 66.67% rounded
    });

    test('should handle empty task list', () => {
        // Clear all tasks
        localStorage.removeItem('tasks');
        tasks = [];
        
        taskManager.tasks = [];
        taskManager.renderTasks();
        
        const emptyState = taskManager.taskList.querySelector('.empty-state');
        expect(emptyState).toBeInTheDocument();
        expect(emptyState.textContent).toContain('No active tasks');
    });
});