const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');

const app = express();
const port = 80;

app.use(bodyParser.json());
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

const SECRET_KEY = 'your-secret-key'; // Добавлено определение SECRET_KEY

const ensureFileExists = (filePath, defaultContent) => {
    if (!fs.existsSync(filePath)) {
        fs.writeFileSync(filePath, JSON.stringify(defaultContent, null, 2));
    }
};

ensureFileExists(path.join(__dirname, 'data', 'projects.json'), []);
ensureFileExists(path.join(__dirname, 'data', 'generationProjects.json'), []);
ensureFileExists(path.join(__dirname, 'data', 'realizationProjects.json'), []);
ensureFileExists('./users.json', []);
ensureFileExists('./statuses.json', [
    { "name": "Запрос", "color": "#007bff" },
    { "name": "Ожидание согласования договора", "color": "#ffc107" },
    { "name": "Ожидание Оплаты", "color": "#17a2b8" },
    { "name": "В пути", "color": "#28a745" },
    { "name": "Выполнено", "color": "#6c757d" },
    { "name": "Отклонено", "color": "#dc3545" }
]);

let users = require('./users.json');
let statuses = require('./statuses.json');

const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (token == null) return res.sendStatus(401);

    jwt.verify(token, SECRET_KEY, (err, user) => {
        if (err) return res.sendStatus(403);
        req.user = user;
        next();
    });
};

const authorizeRole = (role) => {
    return (req, res, next) => {
        if (req.user.role !== role) {
            return res.sendStatus(403);
        }
        next();
    };
};

app.post('/auth/login', (req, res) => {
    const { username, password } = req.body;
    const user = users.find(u => u.username === username);
    if (user == null) {
        return res.status(400).send('Cannot find user');
    }
    if (!bcrypt.compareSync(password, user.password)) {
        return res.status(403).send('Invalid credentials');
    }
    const accessToken = jwt.sign({ username: user.username, role: user.role, firstName: user.firstName, lastName: user.lastName }, SECRET_KEY);
    res.json({ accessToken, role: user.role, firstName: user.firstName, lastName: user.lastName });
});

app.post('/auth/register', (req, res) => {
    const { firstName, lastName, username, password, role } = req.body;
    const user = {
        id: users.length + 1,
        firstName,
        lastName,
        username,
        password: bcrypt.hashSync(password, 10),
        role: role || 'user'
    };
    users.push(user);
    fs.writeFileSync('./users.json', JSON.stringify(users, null, 2));
    const accessToken = jwt.sign({ username: user.username, role: user.role, firstName: user.firstName, lastName: user.lastName }, SECRET_KEY);
    res.json({ accessToken, role: user.role, firstName: user.firstName, lastName: user.lastName });
});

app.delete('/auth/delete', authenticateToken, (req, res) => {
    const { username } = req.body;
    const userIndex = users.findIndex(user => user.username === username);

    if (userIndex === -1) {
        return res.status(404).send('User not found');
    }

    // Проверка, если удаление не администратора или текущего пользователя
    if (users[userIndex].role === 'admin') {
        return res.status(403).send('Cannot delete admin user');
    }

    users = users.filter(user => user.username !== username);
    fs.writeFileSync('./users.json', JSON.stringify(users, null, 2));

    res.send('User deleted successfully');
});

app.get('/auth/users', authenticateToken, (req, res) => {
    res.json(users);
});

function readProjects(type) {
    let filePath = path.join(__dirname, 'data', 'projects.json');
    if (type === 'generation') {
        filePath = path.join(__dirname, 'data', 'generationProjects.json');
    } else if (type === 'realization') {
        filePath = path.join(__dirname, 'data', 'realizationProjects.json');
    }
    if (fs.existsSync(filePath)) {
        const data = fs.readFileSync(filePath);
        console.log(`Reading projects from ${filePath}`);
        return JSON.parse(data);
    }
    console.log(`File not found: ${filePath}`);
    return [];
}

function writeProjects(type, projects) {
    let filePath = path.join(__dirname, 'data', 'projects.json');
    if (type === 'generation') {
        filePath = path.join(__dirname, 'data', 'generationProjects.json');
    } else if (type === 'realization') {
        filePath = path.join(__dirname, 'data', 'realizationProjects.json');
    }
    console.log(`Writing projects to ${filePath}`);
    fs.writeFileSync(filePath, JSON.stringify(projects, null, 2));
}

function createNewProjectTemplate(projectData, type) {
    console.log('Creating project template with data:', projectData);
    const { name, id, employees, goals, dependencies, startDate, endDate, phase, comments, weight, status, products, budget, deadline } = projectData;

    const baseProject = {
        name,
        id,
        employees,
        goals: goals.map(goal => ({
            name: goal.name,
            deadline: goal.deadline,
            status: goal.status || "Запрос",
            rating: goal.rating || 0, // Значение по умолчанию для оценки руководства
            customerRating: goal.customerRating !== undefined ? goal.customerRating : "Нет" // Значение по умолчанию для оценки заказчика
        })),
        dependencies,
        startDate: type === 'projects' ? "0000-00-00" : startDate,
        endDate: type === 'projects' ? "0000-00-00" : endDate,
        phase,
        comments,
        weight,
        status: status || 'Запрос',
        products,
        budget,
        deadline,
        finalCompletionDate: deadline
    };

    if (type === 'generation') {
        return {
            ...baseProject,
            budget
        };
    } else if (type === 'realization') {
        return baseProject;
    }

    return baseProject;
}

function readAllProjects() {
    const dataDir = path.join(__dirname, 'data');
    const projectFiles = ['projects.json', 'generationProjects.json', 'realizationProjects.json'];
    let allProjects = [];

    projectFiles.forEach(file => {
        const filePath = path.join(dataDir, file);
        if (fs.existsSync(filePath)) {
            const data = fs.readFileSync(filePath);
            const projects = JSON.parse(data);
            projects.forEach(project => {
                project.type = file.replace('.json', '');
            });
            allProjects = allProjects.concat(projects);
            console.log(`Reading projects from ${filePath}`);
        } else {
            console.log(`File not found: ${filePath}`);
        }
    });

    return allProjects;
}

function updateDependenciesForProject(newProjectId, dependencies) {
    console.log('Updating dependencies for project:', newProjectId, dependencies);
    const allProjects = readAllProjects();

    dependencies.forEach(depId => {
        const project = allProjects.find(p => p.id === depId);
        if (project) {
            if (!project.dependencies.includes(newProjectId)) {
                project.dependencies.push(newProjectId);
                console.log(`Updated dependencies for project ${depId}:`, project.dependencies);
                const projectType = project.type.replace('Projects', '');
                let projects = readProjects(projectType);
                const index = projects.findIndex(p => p.id === depId);
                projects[index] = project;
                writeProjects(projectType, projects);
            }
        } else {
            console.error(`Project not found: ${depId}`);
        }
    });
}

app.post('/projects', authenticateToken, (req, res, next) => {
    const { name, id, employees, goals, dependencies, startDate, endDate, phase, comments, weight, status, products, budget, deadline, type } = req.body;

    console.log('Received project data:', req.body);

    const missingFields = [];
    if (!name) missingFields.push('name');
    if (!id) missingFields.push('id');
    if (!employees || employees.length === 0) missingFields.push('employees');
    if (!goals || goals.length === 0) missingFields.push('goals');
    if (!type) missingFields.push('type');
    if (type !== 'projects') {
        if (!startDate) missingFields.push('startDate');
        if (!endDate) missingFields.push('endDate');
    } else {
        req.body.startDate = "0000-00-00";
        req.body.endDate = "0000-00-00";
    }
    if (missingFields.length > 0) {
        console.error('Missing required fields:', missingFields);
        return res.status(400).json({ error: `Missing required fields: ${missingFields.join(', ')}` });
    }

    const projectData = {
        name,
        id,
        employees,
        goals,
        dependencies,
        startDate: req.body.startDate,
        endDate: req.body.endDate,
        phase,
        comments,
        weight,
        status,
        type,
        products,
        budget,
        deadline
    };

    console.log('Creating new project with data:', projectData);

    const newProject = createNewProjectTemplate(projectData, type);

    try {
        let projects = readProjects(type);
        console.log('Existing projects:', projects);
        projects.push(newProject);
        writeProjects(type, projects);
        console.log('Project saved successfully:', newProject);

        if (dependencies && dependencies.length > 0) {
            console.log('Updating dependencies for project:', id);
            updateDependenciesForProject(id, dependencies);
        }

        res.status(201).send(newProject);
    } catch (error) {
        console.error('Error saving project:', error);
        next(error);
    }
});

app.get('/projects', authenticateToken, (req, res) => {
    try {
        let projects = readProjects('projects');
        projects = projects.map(project => ({
            ...project,
            deadline: project.deadline // добавляем поле deadline
        }));
        console.log('Returning projects:', projects);
        res.json(projects);
    } catch (error) {
        console.error('Error loading projects:', error);
        res.status(500).send('Internal Server Error');
    }
});

app.get('/projects/generation', authenticateToken, (req, res) => {
    try {
        let generationProjects = readProjects('generation');
        console.log('Returning generation projects:', generationProjects);
        res.json(generationProjects);
    } catch (error) {
        console.error('Error loading generation projects:', error);
        res.status(500).send('Internal Server Error');
    }
});

app.get('/projects/realization', authenticateToken, (req, res) => {
    try {
        let realizationProjects = readProjects('realization');
        console.log('Returning realization projects:', realizationProjects);
        res.json(realizationProjects);
    } catch (error) {
        console.error('Error loading realization projects:', error);
        res.status(500).send('Internal Server Error');
    }
});

app.get('/projects/all', authenticateToken, (req, res) => {
    try {
        const projectsPath = path.join(__dirname, 'data', 'projects.json');
        const generationProjectsPath = path.join(__dirname, 'data', 'generationProjects.json');
        const realizationProjectsPath = path.join(__dirname, 'data', 'realizationProjects.json');

        const projects = JSON.parse(fs.readFileSync(projectsPath));
        const generationProjects = JSON.parse(fs.readFileSync(generationProjectsPath));
        const realizationProjects = JSON.parse(fs.readFileSync(realizationProjectsPath));

        // Добавляем тип проекта, если он отсутствует
        projects.forEach(project => {
            if (!project.type) {
                project.type = 'projects';
            }
        });

        generationProjects.forEach(project => {
            if (!project.type) {
                project.type = 'generation';
            }
        });

        realizationProjects.forEach(project => {
            if (!project.type) {
                project.type = 'realization';
            }
        });

        const allProjects = [...projects, ...generationProjects, ...realizationProjects];

        res.json(allProjects);
    } catch (error) {
        console.error('Error reading projects data:', error);
        res.status(500).send('Error reading projects data');
    }
});

app.patch('/projects/update-dependencies', authenticateToken, (req, res) => {
    const { newProjectId, dependencies } = req.body;

    console.log('Received update dependencies request:', req.body);

    if (!newProjectId || !dependencies) {
        console.error('Missing required fields: newProjectId or dependencies');
        return res.status(400).send('Missing required fields: newProjectId or dependencies');
    }

    try {
        updateDependenciesForProject(newProjectId, dependencies);
        res.status(200).send('Dependencies updated successfully');
    } catch (error) {
        console.error('Error updating dependencies:', error);
        res.status(500).send('Internal Server Error');
    }
});

app.patch('/projects/:id/status', authenticateToken, (req, res) => {
    const { id } = req.params;
    const { status, type, goalName } = req.body;

    if (!type) {
        console.error('Type is required');
        return res.status(400).send('Type is required');
    }

    if (!status) {
        console.error('Invalid status');
        return res.status(400).send('Invalid status');
    }

    let projects = readProjects(type);
    let project = projects.find(p => p.id === id);

    if (!project) {
        console.error('Project not found');
        return res.status(404).send('Project not found');
    }

    if (project.goals && project.goals.length > 0) {
        const goal = project.goals.find(g => g.name === goalName);
        if (goal) {
            goal.status = status;
        }
    }

    writeProjects(type, projects);
    console.log(`Updated status for goal in project ${id} to ${status}`);
    console.log(`Updated project data:`, project);
    res.status(200).send('Goal status updated successfully');
});

app.get('/statuses', authenticateToken, (req, res) => {
    try {
        const statuses = JSON.parse(fs.readFileSync(path.join(__dirname, 'statuses.json')));
        res.json(statuses);
    } catch (error) {
        console.error('Error loading statuses:', error);
        res.status(500).send('Internal Server Error');
    }
});

app.patch('/statuses', authenticateToken, (req, res) => {
    try {
        const updatedStatuses = req.body;
        fs.writeFileSync(path.join(__dirname, 'statuses.json'), JSON.stringify(updatedStatuses, null, 2));
        statuses = updatedStatuses;
        res.status(200).send('Statuses updated successfully');
    } catch (error) {
        console.error('Error updating statuses:', error);
        res.status(500).send('Internal Server Error');
    }
});

app.patch('/projects/:id/rating', authenticateToken, (req, res) => {
    const { id } = req.params;
    const { ratingType, rating, type } = req.body;

    if (!type) {
        return res.status(400).send('Type is required');
    }

    let projects = readProjects(type);
    let project = projects.find(p => p.id === id);

    if (!project) {
        return res.status(404).send('Project not found');
    }

    if (ratingType === 'manager') {
        project.rating = rating;
    } else if (ratingType === 'customer') {
        project.customerRating = rating;
    } else {
        return res.status(400).send('Invalid rating type');
    }

    writeProjects(type, projects);
    res.status(200).send('Project rating updated successfully');
});

app.patch('/projects/:id/completion-date', authenticateToken, (req, res) => {
    const projectId = req.params.id;
    const { date, type } = req.body;

    console.log(`Updating completion date for project ${projectId} of type ${type} to ${date}`);

    let projects = readProjects(type);

    const project = projects.find(p => p.id === projectId);
    if (!project) {
        console.error('Project not found:', projectId);
        return res.status(404).json({ error: 'Project not found' });
    }

    project.finalCompletionDate = date;

    writeProjects(type, projects);

    console.log(`Updated project completion date for project ${projectId} to ${date}`);
    res.json(project);
});
app.patch('/projects/:id/final-completion-date', authenticateToken, (req, res) => {
    const projectId = req.params.id;
    const { date, type } = req.body;

    console.log(`Updating final completion date for project ${projectId} of type ${type} to ${date}`);

    let projects = readProjects(type);
    const project = projects.find(p => p.id === projectId);

    if (!project) {
        return res.status(404).send('Project not found');
    }

    project.finalCompletionDate = date; // Сохранение даты в формате yyyy-mm-dd
    writeProjects(type, projects);

    console.log(`Updated project final completion date for project ${projectId} to ${date}`);
    res.json(project);
});

app.patch('/projects/:id/transfer', authenticateToken, (req, res) => {
    const { id } = req.params;
    const { newEmployee, type } = req.body;

    if (!type) {
        return res.status(400).send('Type is required');
    }

    let projects = readProjects(type); // Ensure this function reads the correct type of projects
    let project = projects.find(p => p.id === id);

    if (!project) {
        return res.status(404).send('Project not found');
    }

    project.employees = [newEmployee];

    writeProjects(type, projects);
    res.status(200).send('Project transferred successfully');
});

app.patch('/projects/:id/add-employee', authenticateToken, (req, res) => {
    const { id } = req.params;
    const { newEmployee, type } = req.body;

    if (!type) {
        return res.status(400).send('Type is required');
    }

    let projects = readProjects(type);
    let project = projects.find(p => p.id === id);

    if (!project) {
        return res.status(404).send('Project not found');
    }

    if (!project.employees.includes(newEmployee)) {
        project.employees.push(newEmployee);
    }

    writeProjects(type, projects);
    res.status(200).send('Employee added successfully');
});

app.patch('/projects/:id/remove-employee', authenticateToken, (req, res) => {
    const { id } = req.params;
    const { employeeToRemove, type } = req.body;

    if (!type) {
        return res.status(400).send('Type is required');
    }

    let projects = readProjects(type);
    let project = projects.find(p => p.id === id);

    if (!project) {
        return res.status(404).send('Project not found');
    }

    project.employees = project.employees.filter(employee => employee !== employeeToRemove);

    writeProjects(type, projects);
    res.status(200).send('Employee removed successfully');
});

app.delete('/projects/:id', authenticateToken, (req, res) => {
    const projectId = req.params.id;
    const { type } = req.query;

    if (!type) {
        return res.status(400).send('Type is required');
    }

    let projects = readProjects(type);
    const projectIndex = projects.findIndex(p => p.id === projectId);

    if (projectIndex === -1) {
        return res.status(404).send('Project not found');
    }

    projects.splice(projectIndex, 1);
    writeProjects(type, projects);

    res.status(200).send('Project deleted successfully');
});
app.patch('/projects/:id/goal-deadline', authenticateToken, (req, res) => {
    const { id } = req.params;
    const { goalName, deadline, type } = req.body;

    if (!type) {
        return res.status(400).send('Type is required');
    }

    let projects = readProjects(type);
    let project = projects.find(p => p.id === id);

    if (!project) {
        return res.status(404).send('Project not found');
    }

    if (project.goals && project.goals.length > 0) {
        const goal = project.goals.find(g => g.name === goalName);
        if (goal) {
            goal.deadline = deadline;
        }
    }

    writeProjects(type, projects);
    res.status(200).send('Goal deadline updated successfully');
});


app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});
