import './App.css'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './components/ui/card'
import { Button } from './components/ui/button'

function App() {
  return (
    <div className="min-h-screen p-6">
      <div className="max-w-3xl mx-auto">
        <Card>
          <CardHeader>
            <CardTitle>PyramidPlay Admin</CardTitle>
            <CardDescription>Bienvenue sur le tableau de bord</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex gap-3">
              <Button>Action primaire</Button>
              <Button variant="secondary">Secondaire</Button>
              <Button variant="outline">Outline</Button>
              <Button variant="ghost">Ghost</Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

export default App
