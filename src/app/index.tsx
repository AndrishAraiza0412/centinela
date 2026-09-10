import { useState } from 'react';
import {
  ActivityIndicator,
  Keyboard,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View
} from 'react-native';

export default function App() {
  const [serviceName, setServiceName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusData, setStatusData] = useState<any | null>(null);
  const checkStatus = async () => {
    if (!serviceName.trim()) return;
    
    Keyboard.dismiss(); // Oculta el teclado al buscar
    setLoading(true);
    setError(null);
    setStatusData(null);

    try {
      // Limpiamos el texto ingresado y lo pasamos a minúsculas
      const query = serviceName.trim().toLowerCase();
      const response = await fetch(`https://isitdownstatus.com/api/v1/status/${query}`);
      
      if (!response.ok) {
        throw new Error('Servicio no encontrado o no monitoreado por esta API.');
      }
      
      const data = await response.json();
      setStatusData(data);
    } catch (err) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError('Ocurrió un error desconocido');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Monitor de Servicios</Text>
        <Text style={styles.subtitle}>Consulta el status real de servicios de TI</Text>
      </View>

      <View style={styles.inputContainer}>
        <TextInput
          style={styles.input}
          placeholder="Ej: github, stripe, aws..."
          value={serviceName}
          onChangeText={setServiceName}
          autoCapitalize="none"
          autoCorrect={false}
          onSubmitEditing={checkStatus}
        />
        <TouchableOpacity style={styles.button} onPress={checkStatus}>
          <Text style={styles.buttonText}>Verificar</Text>
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.resultContainer} contentContainerStyle={styles.scrollContent}>
        {loading && <ActivityIndicator size="large" color="#0066cc" />}
        
        {error && (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>Error: {error}</Text>
          </View>
        )}

        {statusData && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Resultado para: {serviceName}</Text>
            {/* Como la estructura exacta de la API puede variar o incluir muchos campos, 
                imprimimos el JSON formateado para una visualización completa */}
            <Text style={styles.jsonText}>
              {JSON.stringify(statusData, null, 2)}
            </Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f7fa',
  },
  header: {
    padding: 20,
    paddingTop: 60,
    backgroundColor: '#ffffff',
    borderBottomWidth: 1,
    borderBottomColor: '#e1e4e8',
    alignItems: 'center',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#24292e',
  },
  subtitle: {
    fontSize: 14,
    color: '#586069',
    marginTop: 5,
  },
  inputContainer: {
    flexDirection: 'row',
    padding: 20,
    gap: 10,
  },
  input: {
    flex: 1,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#d1d5da',
    borderRadius: 8,
    paddingHorizontal: 15,
    height: 50,
    fontSize: 16,
  },
  button: {
    backgroundColor: '#0066cc',
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 8,
    paddingHorizontal: 20,
    height: 50,
  },
  buttonText: {
    color: '#ffffff',
    fontWeight: 'bold',
    fontSize: 16,
  },
  resultContainer: {
    flex: 1,
    paddingHorizontal: 20,
  },
  scrollContent: {
    paddingBottom: 40,
  },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 8,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 15,
    color: '#24292e',
    textTransform: 'capitalize',
  },
  jsonText: {
    fontFamily: 'monospace',
    fontSize: 14,
    color: '#333333',
  },
  errorBox: {
    backgroundColor: '#ffeef0',
    borderColor: '#ffdce0',
    borderWidth: 1,
    padding: 15,
    borderRadius: 8,
  },
  errorText: {
    color: '#cb2431',
    fontWeight: '500',
  }
});